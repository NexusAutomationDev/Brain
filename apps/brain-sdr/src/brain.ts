// D-01: LLM decide quando acionar qualify_lead via tool call
// D-02: Grafo ReAct com 3 nós: llm → routeAfterLlm → (tools | respond | __end__)
// D-03: Única tool em v1.1: qualify_lead
// D-04: boundQualifyTool criado em buildGraph() com closure sobre ctx.prompts["qualification"]
//        — garante que o prompt do banco é sempre usado, zero hardcode (SDR-04)
// Anti-pattern: NUNCA chamar compile() aqui — BrainRunner é responsável (runner.ts)
// Anti-pattern: NUNCA usar ctx.tools no ToolNode — usar [boundQualifyTool] diretamente

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation, extractTokenUsage } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
import { createPauseSessionTool, createFinishConversationTool, createRespondTool, createSearchKnowledgeTool, hasToolCall, getFirstToolCallName } from "@brain-pkg/core";
import { createEmbeddingProvider } from "@brain-pkg/embeddings";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import { qualifyLeadTool, runQualificationAgent } from "./qualifier.js";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

// D-02 (Phase 28): buildGraph() é síncrono por contrato (IBrain) — createEmbeddingProvider()
// é async, então não pode ser await'd diretamente no corpo de buildGraph(). LazyEmbeddingProvider
// resolve o provider real (memoizado no processo) na primeira chamada de embed()/embedQuery() —
// providerName/dimensions refletem a instância real assim que a Promise resolve, o que satisfaz
// search-knowledge.ts (só lê providerName após o await de embedQuery()).
let embeddingProviderPromise: Promise<IEmbeddingProvider> | null = null;
function getEmbeddingProvider(): Promise<IEmbeddingProvider> {
  if (!embeddingProviderPromise) {
    embeddingProviderPromise = createEmbeddingProvider();
  }
  return embeddingProviderPromise;
}

class LazyEmbeddingProvider implements IEmbeddingProvider {
  private resolved: IEmbeddingProvider | null = null;

  get providerName(): string {
    return this.resolved?.providerName ?? "unresolved";
  }

  get dimensions(): number {
    return this.resolved?.dimensions ?? 0;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.resolved = await getEmbeddingProvider();
    return this.resolved.embed(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    this.resolved = await getEmbeddingProvider();
    return this.resolved.embedQuery(text);
  }
}

function lazyEmbeddingProvider(): IEmbeddingProvider {
  return new LazyEmbeddingProvider();
}

// Schema estático para sdrBrain.tools[] — campo declarativo IBrain (D-02 Phase 23)
// NÃO é executado em produção; createSearchKnowledgeTool(ctx.sql!) é a versão bound.
// Segue o padrão de qualifyLeadTool em qualifier.ts.
const searchKnowledgeToolSchema = tool(
  async () => "schema placeholder — não executado diretamente",
  {
    name: "search_knowledge",
    description:
      "Busca contexto relevante na base de conhecimento. Use quando precisar de informações sobre produtos, FAQs, manuais ou qualquer conteúdo ingerido nas coleções disponíveis.",
    schema: z.object({
      query: z.string().min(1).describe("Texto da busca semântica"),
      collections: z
        .array(z.string().min(1))
        .min(1)
        .describe("Lista de coleções para buscar (mínimo 1)"),
    }),
  }
);

// WR-01 (31-REVIEW) / TECH-05 gap fix: MCP tools whose name collides with a reserved
// native tool name must never reach bindTools()/ToolNode — an operator-configured MCP_URL
// server exposing e.g. "respond" would otherwise create two same-named tool objects with
// undefined precedence, silently defeating the "never disableable" guarantee.
const RESERVED_TOOL_NAMES = new Set([
  "respond",
  "search_knowledge",
  "pause_session",
  "finish_conversation",
  "qualify_lead",  // brain-sdr-specific
]);

export const sdrBrain: IBrain = {
  id: "brain-sdr",
  brainType: "sdr",
  // D-08: promptKeys obrigatórios — BrainRunner.init() faz process.exit(1) se algum faltar no banco
  promptKeys: ["system", "qualification"],
  // D-03 (Phase 23): qualify_lead + search_knowledge — campo estático para BrainRunner/ToolsRegistry
  // NOTA: tools[] lista as tools disponíveis para o IBrain.
  //       Em execução, buildGraph() cria boundQualifyTool e boundSearchKnowledgeTool com closures reais.
  tools: [qualifyLeadTool, searchKnowledgeToolSchema],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-04: boundQualifyTool — closure sobre ctx.prompts["qualification"] (SDR-04)
    // Garante que o prompt do banco é passado ao sub-agente em cada invocação da tool.
    // qualifyLeadTool (módulo) serve apenas como contrato de schema/name/description.
    // Fix: session_id removido do schema — LLM não sabe o valor real.
    // thread_id é injetado via RunnableConfig do LangGraph (config.configurable.thread_id).
    const boundQualifyTool = tool(
      async ({ description }, config) => {
        const sessionId = (config as any)?.configurable?.thread_id ?? "";
        logger.info({ sessionId }, "qualify_lead tool called (boundQualifyTool)");
        const result = await runQualificationAgent(
          description,
          sessionId,
          ctx.prompts["qualification"] // D-04: prompt do banco — zero hardcode
        );
        return JSON.stringify(result);
      },
      {
        name: qualifyLeadTool.name,
        description: qualifyLeadTool.description,
        schema: z.object({
          description: z
            .string()
            .describe(
              "Breve descrição do momento da conversa e comportamento do lead que motivou a qualificação"
            ),
        }),
      }
    );

    // D-04 (Fase 12): bound com closure sobre ctx.sql — injetado pelo BrainRunner (sempre presente para brain-sdr)
    // ctx.sql! é seguro: index.ts passa sql no construtor do BrainRunner (linha 67)
    const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
    const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);

    // D-01 (Phase 23): search_knowledge bound com closure sobre ctx.sql — RAG-02/RAG-03
    // D-02 (Phase 28): embeddingProvider injetado via createEmbeddingProvider() (@brain-pkg/embeddings).
    // buildGraph() é síncrono por contrato (IBrain) — não pode await aqui. lazyEmbeddingProvider()
    // resolve o provider real de forma lazy/memoizada na primeira chamada real (dentro do handler
    // async da tool), mirroring o padrão de getEmbedder() lazy nos providers de @brain-pkg/embeddings.
    const boundSearchKnowledgeTool = createSearchKnowledgeTool(ctx.sql!, lazyEmbeddingProvider());

    // D-09 (Fase 16): respond tool para responseMode dinâmico (schema-as-tool)
    const respondTool = createRespondTool();

    // CRITICAL: bindTools() com [boundQualifyTool] — não ctx.tools
    // ctx.tools vem do ToolsRegistry e contém qualifyLeadTool sem closure;
    // usar boundQualifyTool garante que o prompt do banco é injetado.
    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime garante provider com tool calling
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível (ex: OpenAI, Anthropic, Gemini)");
    }

    // D-03/TECH-01: Filtrar tools nativas pelo enabledTools whitelist.
    // ctx.enabledTools = null → sem filtro (BRAIN_TOOLS não setado).
    // ctx.enabledTools = Set<string> → apenas tools com nome no Set são vinculadas ao LLM.
    // Aplica-se a closures nativas (boundQualifyTool, pause_session, finish_conversation)
    // E a ctx.mcpTools injetadas.
    //
    // D-01/TECH-05: search_knowledge AND respond appended AFTER filter — never excludable
    // by BRAIN_TOOLS (same pattern as brain-support's search_knowledge protection).
    const nativeTools = [
      boundQualifyTool,
      boundPauseSessionTool,
      boundFinishConversationTool,
      // respondTool deliberately excluded — appended after filter
    ];

    // WR-01 fix: drop any MCP tool whose name collides with a reserved native tool name
    // BEFORE concatenation — closes the gap where an MCP_URL server exposing "respond"
    // (or other reserved tools) could shadow the native closure with undefined precedence.
    const safeMcpTools = ctx.mcpTools.filter((t) => {
      const collides = RESERVED_TOOL_NAMES.has(t.name);
      if (collides) {
        logger.warn(
          { toolName: t.name },
          "MCP tool nome colide com tool nativa reservada — descartada (WR-01/TECH-05)"
        );
      }
      return !collides;
    });

    const allToolsExceptSearchAndRespond = [...nativeTools, ...safeMcpTools];
    const filteredExceptSearchAndRespond = ctx.enabledTools
      ? allToolsExceptSearchAndRespond.filter((t) => ctx.enabledTools!.has(t.name))
      : allToolsExceptSearchAndRespond;
    // D-01/TECH-05: search_knowledge AND respond appended AFTER filter — never excludable by BRAIN_TOOLS
    const filteredAllTools = [...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool];

    const llmWithTools = ctx.llm.bindTools(filteredAllTools);

    // HIST-03: context window — slice feito no nó, não no invoke() (Pitfall 3 do runner.ts)
    const getContextWindow = (): number => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40; // SECURITY: T-08-ENV
    };

    // D-01 (Fase 16): router customizado — substitui toolsCondition
    // Inspeciona o NOME do tool_call em vez de apenas a presença
    function routeAfterLlm(state: typeof BrainStateAnnotation.State): "respond" | "tools" | typeof END {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      const firstToolCallName = getFirstToolCallName(lastMessage);
      if (firstToolCallName === undefined) return END;
      // D-01: respond tool → nó respond; qualquer outra tool → ReAct loop
      if (firstToolCallName === "respond") return "respond";
      return "tools";
    }

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // Substituição de {{ $json.Name }} no system prompt
        const systemContent = ctx.prompts["system"]
          .replace(/\{\{\s*\$json\.Name\s*\}\}/g, state.leadName || "");

        // Fix: garantir que o slice começa em HumanMessage — evita AIMessage/ToolMessage
        // órfão no início da janela, que o Gemini rejeita com 400 Bad Request.
        const allMessages = state.messages;
        const windowSize = getContextWindow();
        let sliceStart = Math.max(0, allMessages.length - windowSize);
        while (sliceStart < allMessages.length && allMessages[sliceStart]._getType() !== "human") {
          sliceStart++;
        }
        const messagesForLLM = allMessages.slice(sliceStart);

        // Injetar data/hora atual na última mensagem do lead (não persiste no checkpoint)
        // Substitui {{ $now.format(...) }} e {{ $now.setLocale(...).weekdayLong }} (syntax n8n)
        const nowTs = new Date();
        const nowTz = 'America/Sao_Paulo';
        const nowParts = new Intl.DateTimeFormat('pt-BR', {
          timeZone: nowTz, day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(nowTs);
        const nowP: Record<string, string> = Object.fromEntries(nowParts.map(({ type, value }) => [type, value]));
        const nowFormatted = `${nowP.day}/${nowP.month}/${nowP.year} ${nowP.hour}:${nowP.minute}`;
        const nowWeekday = new Intl.DateTimeFormat('pt-BR', { timeZone: nowTz, weekday: 'long' }).format(nowTs);
        const enrichedMessages = messagesForLLM.map((msg, idx) => {
          if (idx === messagesForLLM.length - 1 && msg._getType() === "human") {
            const original = typeof msg.content === "string" ? msg.content : "";
            const enriched = `<informacoes>\nO horário atual é ${nowFormatted} de um(a) ${nowWeekday}\n</informacoes>\n\nmensagem:\n${original}`;
            return new HumanMessage(enriched);
          }
          return msg;
        });

        const response = await llmWithTools.invoke([
          { role: "system", content: systemContent },
          ...enrichedMessages,
        ]);
        // Fase 16: Lógica dual — caminho normal (respond tool) vs fallback D-10 (texto plano)
        const fullResponse = typeof response.content === "string" ? response.content : "";
        const hasRespondCall = hasToolCall(response, "respond");
        const toolCalls = (response as AIMessage).tool_calls ?? [];
        const hasOtherToolCall = !hasRespondCall && toolCalls.length > 0;

        if (hasOtherToolCall) {
          // LLM chamou uma tool que não é respond (ex: getAvailableDate, qualify_lead)
          // Deixar routeAfterLlm rotear para "tools" — NÃO setar brainOutput aqui
          return {
            messages: [response],
            tokenUsage: extractTokenUsage(response),
          };
        }

        if (!hasRespondCall) {
          // D-10 (Fase 16): PITFALL-6 real — LLM emitiu texto sem nenhuma tool call
          const fallback = fullResponse || "Desculpe, tive um problema técnico. Pode repetir?";
          if (!fullResponse) {
            logger.warn("LLM emitiu resposta vazia sem tool call — PITFALL-6");
          } else {
            logger.warn({ content: fullResponse }, "LLM emitiu texto plano sem respond tool — PITFALL-6");
          }
          return {
            messages: [response],
            brainOutput: { fullResponse: fallback, responseMode: "undefined" as const },
            tokenUsage: extractTokenUsage(response),
          };
        }

        // Caminho normal: respond tool será chamada pelo nó respond
        // brainOutput será setado pelo nó respond — não setar aqui
        return {
          messages: [response],
          tokenUsage: extractTokenUsage(response),
        };
      })
      // D-07 (Fase 12): ToolNode com tools filtradas — sincronizado com filteredAllTools do LLM (TECH-01)
      // Fase 16: respondTool excluída do ToolNode de tools — tem seu próprio nó "respond"
      // Phase 23: boundSearchKnowledgeTool adicionada ao ToolNode (D-01) — RAG-02/RAG-03
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage — evita thread corrompido (PITFALL-2)
      // TECH-01: O ToolNode usa as mesmas tools filtradas — LLM só pode chamar o que está bound
      .addNode("tools", new ToolNode(
        filteredAllTools,
        { handleToolErrors: true }
      ))
      // D-02 (Fase 16): nó respond como nó regular (não ToolNode) — pode setar brainOutput + messages
      // PITFALL-4: emitir ToolMessage para manter paridade AIMessage/ToolMessage no PostgresSaver
      .addNode("respond", async (state) => {
        const messages = state.messages;
        let respondCall: any = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai") {
            const tc = (msg as AIMessage).tool_calls ?? [];
            respondCall = tc.find((c: any) => c.name === "respond");
            if (respondCall) break;
          }
        }
        if (!respondCall) {
          logger.error("respondNode chamado sem tool_call 'respond' no estado — estado inconsistente");
          return {};
        }
        const args = respondCall.args;
        // D-05 (Fase 16): mapear mediaType "file" → "document" antes de BrainOutputSchema.parse()
        const mediaType = args.mediaType === "file" ? "document" : args.mediaType;
        const toolMessage = new ToolMessage({
          content: "ok",
          tool_call_id: respondCall.id ?? "",
          name: "respond",
        });
        return {
          messages: [toolMessage], // D-02: paridade AIMessage/ToolMessage
          brainOutput: {
            fullResponse: args.fullResponse,
            responseMode: args.responseMode,
            ...(mediaType ? { mediaType } : {}),
            ...(args.mediaUrl ? { mediaUrl: args.mediaUrl } : {}),
          },
        };
      })
      .addEdge("__start__", "llm")
      // D-01 (Fase 16): routeAfterLlm substitui toolsCondition — 3 destinos
      .addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])
      .addEdge("tools", "llm")
      .addEdge("respond", "__end__"); // D-01 (Fase 16): respond sempre termina o turno
    // NUNCA chamar compile() aqui — BrainRunner._compileGraph() é responsável
  },
};
