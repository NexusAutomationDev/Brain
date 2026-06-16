// D-01: EchoBrain usa LLM real + system prompt carregado da tabela `prompts`
// D-02: tools = [] — sem tools nativas no echo; MCP tools injetadas via ctx.mcpTools (D-03)
// D-03: buildGraph() retorna StateGraph NÃO compilado — BrainRunner chama .compile({ checkpointer })
// MCP-02, D-03: brain-echo tem ReAct completo para suportar ctx.mcpTools dinamicamente
// Fase 16: routeAfterLlm substitui toolsCondition — 3 destinos (respond/tools/__end__)

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation, extractTokenUsage } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
import { createRespondTool } from "@brain-pkg/core";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

export const echoBrain: IBrain = {
  id: "brain-echo",
  brainType: "echo",
  promptKeys: ["system"],
  tools: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-03: NUNCA chamar .compile() aqui — BrainRunner é o responsável

    // D-09 (Fase 16): respond tool para responseMode dinâmico (schema-as-tool)
    const respondTool = createRespondTool();

    // MCP-02, D-03: brain-echo não tem tools nativas — apenas respond tool + MCP tools
    // D-02: ctx.mcpTools é sempre array (nunca undefined); [] quando MCP_URL não definido
    // D-09 (Fase 16): allTools inclui respondTool + mcpTools para bindTools
    const allTools = [respondTool, ...ctx.mcpTools];

    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível");
    }

    // D-11, MCP-04: bindTools com allTools (respond + mcpTools)
    const llmWithTools = ctx.llm.bindTools(allTools);

    const contextWindowSize = (() => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;  // SECURITY: T-08-ENV
    })();

    // D-01 (Fase 16): router customizado — substitui toolsCondition
    // GUARDA brain-echo: captura hasMcpTools via closure para evitar ToolNode vazio
    // T-16-10: routeAfterLlm com guarda !hasMcpTools retorna END antes de atingir ToolNode vazio
    const hasMcpTools = ctx.mcpTools.length > 0;
    function routeAfterLlm(state: any): "respond" | "tools" | typeof END {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || !("tool_calls" in lastMessage)) return END;
      const toolCalls = (lastMessage as AIMessage).tool_calls ?? [];
      if (toolCalls.length === 0) return END;
      if (toolCalls[0].name === "respond") return "respond";
      // Guarda: sem MCP tools registradas, qualquer outra tool call é inatingível via ToolNode.
      // Cai no fallback D-10 em vez de tentar executar um ToolNode vazio.
      if (!hasMcpTools) return END;
      return "tools";
    }

    // toolsForToolNode contém apenas MCP tools — respondTool tem seu próprio nó
    // Pode ser [] quando ctx.mcpTools=[] — nesse caso o nó "tools" existe mas nunca é atingido
    // (routeAfterLlm retorna END quando !hasMcpTools)
    const toolsForToolNode = [...ctx.mcpTools];

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // D-01: system prompt carregado de ctx.prompts['system'] (nunca hardcoded)
        // HIST-03: slice no nó, não no invoke() do BrainRunner — evita duplicação
        const messagesForLLM = state.messages.slice(-contextWindowSize);

        const response = await llmWithTools.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);

        // Fase 16: Lógica dual — caminho normal (respond tool) vs fallback D-10 (texto plano)
        const fullResponse =
          typeof response.content === "string" ? response.content : "";
        const toolCalls = (response as AIMessage).tool_calls ?? [];
        const hasRespondCall = toolCalls.some((tc: any) => tc.name === "respond");

        if (!hasRespondCall) {
          // D-10 (Fase 16): fallback — LLM emitiu texto plano sem invocar respond tool (PITFALL-6)
          // Comportamento degradado — não erro; logar como warn
          if (!fullResponse) {
            logger.warn("LLM emitiu resposta vazia sem tool call — PITFALL-6");
          } else {
            logger.warn({ content: fullResponse }, "LLM emitiu texto plano sem respond tool — PITFALL-6");
          }
          // D-03 nota: brain-echo usa [...state.messages, response] — preserva compatibilidade com v1.2
          return {
            messages: [...state.messages, response],
            brainOutput: {
              fullResponse,
              responseMode: "undefined" as const,
            },
            tokenUsage: extractTokenUsage(response),
          };
        }

        // Caminho normal: respond tool será chamada pelo nó respond
        // brainOutput será setado pelo nó respond — não setar aqui
        return {
          messages: [...state.messages, response],
          tokenUsage: extractTokenUsage(response),
        };
      })
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage
      // Fase 16: toolsForToolNode exclui respondTool — respond tool tem nó dedicado
      .addNode("tools", new ToolNode(toolsForToolNode, { handleToolErrors: true }))
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
  },
};
