// D-01: EchoBrain usa LLM real + system prompt carregado da tabela `prompts`
// D-02: tools = [] — sem tools nativas no echo; MCP tools injetadas via ctx.mcpTools (D-03)
// D-03: buildGraph() retorna StateGraph NÃO compilado — BrainRunner chama .compile({ checkpointer })
// MCP-02, D-03: brain-echo tem ReAct completo para suportar ctx.mcpTools dinamicamente

import { StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation, extractTokenUsage } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";

export const echoBrain: IBrain = {
  id: "brain-echo",
  brainType: "echo",
  promptKeys: ["system"],
  tools: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-03: NUNCA chamar .compile() aqui — BrainRunner é o responsável

    // MCP-02, D-03: brain-echo não tem tools nativas — apenas MCP tools dinamicamente injetadas
    // D-02: ctx.mcpTools é sempre array (nunca undefined); [] quando MCP_URL não definido
    const allTools = [...ctx.mcpTools];

    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível");
    }

    // D-11, MCP-04: bindTools com allTools (pode ser []) — LLM sem tools usa toolsCondition → __end__
    const llmWithTools = ctx.llm.bindTools(allTools);

    const contextWindowSize = (() => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;  // SECURITY: T-08-ENV
    })();

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // D-01: system prompt carregado de ctx.prompts['system'] (nunca hardcoded)
        // HIST-03: slice no nó, não no invoke() do BrainRunner — evita duplicação
        const messagesForLLM = state.messages.slice(-contextWindowSize);

        const response = await llmWithTools.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);

        // SDK-06: BrainOutput manual — sem .withStructuredOutput()
        const fullResponse =
          typeof response.content === "string" ? response.content : "";

        // D-03 nota: messages com spread (para não duplicar histórico no ReAct)
        // brain-echo usa [...state.messages, response] — preserva compatibilidade com v1.2
        return {
          messages: [...state.messages, response],
          brainOutput: {
            fullResponse,
            responseMode: "text" as const,
          },
          tokenUsage: extractTokenUsage(response),
        };
      })
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage
      .addNode("tools", new ToolNode(allTools, { handleToolErrors: true }))
      .addEdge("__start__", "llm")
      // toolsCondition: vai para "tools" se LLM emitiu tool_calls, senão "__end__"
      // Com allTools = [] e nenhuma tool disponível, LLM nunca emite tool_calls → sempre __end__
      .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
      .addEdge("tools", "llm");
  },
};
