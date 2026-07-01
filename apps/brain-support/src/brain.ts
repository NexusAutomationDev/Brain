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
import { createPauseSessionTool, createFinishConversationTool, createRespondTool, createSearchKnowledgeTool } from "@brain-pkg/core";
import { createEmbeddingProvider } from "@brain-pkg/embeddings";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
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

    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime garante provider com tool calling
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível (ex: OpenAI, Anthropic, Gemini)");
    }

    // D-04 (Phase 29, crítico): search_knowledge NUNCA pode ser filtrada por BRAIN_TOOLS.
    // nativeTools exclui deliberadamente boundSearchKnowledgeTool — o filtro ctx.enabledTools
    // roda apenas sobre nativeTools + mcpTools, e boundSearchKnowledgeTool é apendado DEPOIS,
    // por referência direta de variável (não por lookup de nome) — não é spoofável via
    // BRAIN_TOOLS nem via tool_calls do LLM (T-29-01).
    const nativeTools = [
      boundPauseSessionTool,
      boundFinishConversationTool,
      respondTool,
    ];
    const allToolsExceptSearch = [...nativeTools, ...ctx.mcpTools];
    const filteredExceptSearch = ctx.enabledTools
      ? allToolsExceptSearch.filter((t) => ctx.enabledTools!.has(t.name))
      : allToolsExceptSearch;
    // D-04/SUP-02: search_knowledge é apendada APÓS o filtro de enabledTools rodar —
    // ela nunca pode ser excluída por BRAIN_TOOLS, diferente de qualquer outra tool.
    const filteredAllTools = [...filteredExceptSearch, boundSearchKnowledgeTool];

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
      if (!lastMessage || !("tool_calls" in lastMessage)) return END;
      const toolCalls = (lastMessage as AIMessage).tool_calls ?? [];
      if (toolCalls.length === 0) return END;
      // respond tool → nó respond; qualquer outra tool → ReAct loop
      if (toolCalls[0].name === "respond") return "respond";
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
        const toolCalls = (response as AIMessage).tool_calls ?? [];
        const hasRespondCall = toolCalls.some((tc: any) => tc.name === "respond");
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
