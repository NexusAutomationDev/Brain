// D-01/D-02 (Phase 29): pause_session e finish_conversation são closures nativas em
//        buildGraph(), exatamente como no SDR — sem equivalente MCP dinâmico (ver 29-CONTEXT.md).
// D-04 (Phase 29): search_knowledge é estruturalmente sempre ativa — bypassa o filtro
//        ctx.enabledTools (BRAIN_TOOLS) apendando a tool DEPOIS do filtro ser aplicado.
// D-06 (Phase 29): sem sub-agente de qualificação — promptKeys é somente ["system"].
// Anti-pattern: NUNCA chamar compile() aqui — BrainRunner é responsável (runner.ts)
// Anti-pattern: NUNCA usar ctx.tools no ToolNode — usar filteredAllTools diretamente

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
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

// D-02 (Phase 28): buildGraph() é síncrono por contrato (IBrain) — createEmbeddingProvider()
// é async, então não pode ser await'd diretamente no corpo de buildGraph(). LazyEmbeddingProvider
// resolve o provider real (memoizado no processo) na primeira chamada de embed()/embedQuery() —
// providerName/dimensions refletem a instância real assim que a Promise resolve, o que satisfaz
// search-knowledge.ts (só lê providerName após o await de embedQuery()).
/**
 * D-05/D-10 (Phase 32, IN-02 29-REVIEW): Process-lifetime singleton, no invalidation
 * mechanism by design. EMBEDDING_PROVIDER/EMBEDDING_MODEL/EMBEDDING_DIMENSIONS are set
 * via ENV at container start and never change at runtime — matches the project's
 * per-client Docker image deployment model (CLAUDE.md). No config-reload use case exists
 * today; building invalidation infrastructure for a scenario that cannot occur in this
 * deployment model would be unused code.
 */
let embeddingProviderPromise: Promise<IEmbeddingProvider> | null = null;
function getEmbeddingProvider(): Promise<IEmbeddingProvider> {
  if (!embeddingProviderPromise) {
    embeddingProviderPromise = createEmbeddingProvider();
  }
  return embeddingProviderPromise;
}

/**
 * D-02 (Phase 28)/D-04 (Phase 32, IN-02 29-REVIEW): buildGraph() is synchronous by IBrain
 * contract — the real provider can only be resolved lazily, inside the first embed()/
 * embedQuery() call. Until that first call resolves, `dimensions` reads as 0 and
 * `providerName` reads as "unresolved" — these are placeholder values, NOT the real
 * provider's config. Callers must not read dimensions/providerName before the first
 * embed()/embedQuery() call completes. search-knowledge.ts only reads providerName AFTER
 * awaiting embedQuery(), which is why this has never surfaced as a bug — documented here
 * so future callers know not to read these eagerly. Changing these to async getters would
 * be a breaking change to IEmbeddingProvider (implemented by other Brains) — out of scope.
 */
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

// Schema estático para supportBrain.tools[] — campo declarativo IBrain (D-02 Phase 23, herdado)
// NÃO é executado em produção; createSearchKnowledgeTool(ctx.sql!) é a versão bound.
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

export const supportBrain: IBrain = {
  id: "brain-support",
  brainType: "support",
  // D-06: promptKeys obrigatórios — BrainRunner.init() faz process.exit(1) se algum faltar no banco.
  // Sem "qualification" — Brain Suporte não tem sub-agente de qualificação (D-06).
  promptKeys: ["system"],
  // D-01/D-06: sem tool de qualificação de lead — apenas search_knowledge como schema estático declarativo.
  tools: [searchKnowledgeToolSchema],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-02: bound com closure sobre ctx.sql — injetado pelo BrainRunner (sempre presente para brain-support)
    // ctx.sql! é seguro: index.ts passa sql no construtor do BrainRunner
    const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
    const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);

    // D-04: search_knowledge bound com closure sobre ctx.sql — RAG-02/RAG-03, sempre ativa (SUP-02)
    const boundSearchKnowledgeTool = createSearchKnowledgeTool(ctx.sql!, lazyEmbeddingProvider());

    // D-09 (Fase 16, herdado): respond tool para responseMode dinâmico (schema-as-tool)
    const respondTool = createRespondTool();

    // D-09/IN-01 (29-REVIEW): RESERVED_TOOL_NAMES derived from the actual native tool instances
    // created above, not a hand-maintained literal — cannot go stale on a future refactor.
    const RESERVED_TOOL_NAMES = new Set<string>(
      [boundPauseSessionTool, boundFinishConversationTool, boundSearchKnowledgeTool, respondTool].map((t) => t.name)
    );

    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime garante provider com tool calling
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível (ex: OpenAI, Anthropic, Gemini)");
    }

    // D-04 (Phase 29, crítico): search_knowledge NUNCA pode ser filtrada por BRAIN_TOOLS.
    // nativeTools exclui deliberadamente boundSearchKnowledgeTool E respondTool — o filtro
    // ctx.enabledTools roda apenas sobre nativeTools + mcpTools, e boundSearchKnowledgeTool
    // + respondTool são apendados DEPOIS, por referência direta de variável (não por lookup
    // de nome) — não são spoofáveis via BRAIN_TOOLS nem via tool_calls do LLM (T-29-01, TECH-05).
    const nativeTools = [
      boundPauseSessionTool,
      boundFinishConversationTool,
      // respondTool deliberately excluded — appended after filter
    ];
    // WR-01 fix: drop any MCP tool whose name collides with a reserved native tool name
    // BEFORE concatenation — closes the SUP-02 gap where an MCP_URL server exposing
    // "search_knowledge" (or pause_session/finish_conversation/respond) could shadow
    // the native closure with undefined bindTools()/ToolNode precedence.
    const safeMcpTools = ctx.mcpTools.filter((t) => {
      const collides = RESERVED_TOOL_NAMES.has(t.name);
      if (collides) {
        logger.warn(
          { toolName: t.name },
          "MCP tool nome colide com tool nativa reservada — descartada (WR-01/SUP-02)"
        );
      }
      return !collides;
    });
    const allToolsExceptSearchAndRespond = [...nativeTools, ...safeMcpTools];
    const filteredExceptSearchAndRespond = ctx.enabledTools
      ? allToolsExceptSearchAndRespond.filter((t) => ctx.enabledTools!.has(t.name))
      : allToolsExceptSearchAndRespond;
    // D-04/SUP-02 + TECH-05/D-01: search_knowledge AND respond appended AFTER filter —
    // never excludable by BRAIN_TOOLS, unlike other tools.
    const filteredAllTools = [...filteredExceptSearchAndRespond, boundSearchKnowledgeTool, respondTool];

    const llmWithTools = ctx.llm.bindTools(filteredAllTools);

    // HIST-03: context window — slice feito no nó, não no invoke() (Pitfall 3 do runner.ts)
    const getContextWindow = (): number => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40; // SECURITY: T-08-ENV
    };

    // D-01 (Fase 16, herdado): router customizado — substitui toolsCondition
    // Inspeciona o NOME do tool_call em vez de apenas a presença
    function routeAfterLlm(state: typeof BrainStateAnnotation.State): "respond" | "tools" | typeof END {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      const firstToolCallName = getFirstToolCallName(lastMessage);
      if (firstToolCallName === undefined) return END;
      // respond tool → nó respond; qualquer outra tool → ReAct loop
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
        // Lógica dual — caminho normal (respond tool) vs fallback D-10 (texto plano)
        const fullResponse = typeof response.content === "string" ? response.content : "";
        const hasRespondCall = hasToolCall(response, "respond");
        const toolCalls = (response as AIMessage).tool_calls ?? [];
        const hasOtherToolCall = !hasRespondCall && toolCalls.length > 0;

        if (hasOtherToolCall) {
          // LLM chamou uma tool que não é respond (ex: search_knowledge, pause_session)
          // Deixar routeAfterLlm rotear para "tools" — NÃO setar brainOutput aqui
          return {
            messages: [response],
            tokenUsage: extractTokenUsage(response),
          };
        }

        if (!hasRespondCall) {
          // D-10 (Fase 16, herdado): PITFALL-6 real — LLM emitiu texto sem nenhuma tool call
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
      // D-07 (Fase 12, herdado): ToolNode com tools filtradas — sincronizado com filteredAllTools do LLM
      // Fase 16: respondTool excluída do ToolNode de tools — tem seu próprio nó "respond"
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage — evita thread corrompido (PITFALL-2)
      .addNode("tools", new ToolNode(
        filteredAllTools,
        { handleToolErrors: true }
      ))
      // D-02 (Fase 16, herdado): nó respond como nó regular (não ToolNode) — pode setar brainOutput + messages
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
        // D-05 (Fase 16, herdado): mapear mediaType "file" → "document" antes de BrainOutputSchema.parse()
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
      .addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])
      .addEdge("tools", "llm")
      .addEdge("respond", "__end__"); // respond sempre termina o turno
    // NUNCA chamar compile() aqui — BrainRunner._compileGraph() é responsável
  },
};
