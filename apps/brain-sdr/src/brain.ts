// D-01: LLM decide quando acionar qualify_lead via tool call
// D-02: Grafo ReAct com 2 nós: llm → (toolsCondition?) → tools → llm → __end__
// D-03: Única tool em v1.1: qualify_lead
// D-04: boundQualifyTool criado em buildGraph() com closure sobre ctx.prompts["qualification"]
//        — garante que o prompt do banco é sempre usado, zero hardcode (SDR-04)
// Anti-pattern: NUNCA chamar compile() aqui — BrainRunner é responsável (runner.ts)
// Anti-pattern: NUNCA usar ctx.tools no ToolNode — usar [boundQualifyTool] diretamente

import { tool } from "@langchain/core/tools";
import { StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { BrainStateAnnotation, extractTokenUsage } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";
import { createPauseSessionTool, createFinishConversationTool } from "@brain-pkg/core";
import { qualifyLeadTool, runQualificationAgent } from "./qualifier.js";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

export const sdrBrain: IBrain = {
  id: "brain-sdr",
  brainType: "sdr",
  // D-08: promptKeys obrigatórios — BrainRunner.init() faz process.exit(1) se algum faltar no banco
  promptKeys: ["system", "qualification"],
  // D-03: Apenas qualify_lead em v1.1 — campo estático para BrainRunner/ToolsRegistry
  // NOTA: tools[] lista as tools disponíveis para o IBrain.
  //       Em execução, buildGraph() cria boundQualifyTool com o prompt real do banco.
  tools: [qualifyLeadTool],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildGraph(ctx: BrainBuildContext): any {
    // D-04: boundQualifyTool — closure sobre ctx.prompts["qualification"] (SDR-04)
    // Garante que o prompt do banco é passado ao sub-agente em cada invocação da tool.
    // qualifyLeadTool (módulo) serve apenas como contrato de schema/name/description.
    const boundQualifyTool = tool(
      async ({ description, session_id }) => {
        logger.info({ session_id }, "qualify_lead tool called (boundQualifyTool)");
        const result = await runQualificationAgent(
          description,
          session_id,
          ctx.prompts["qualification"] // D-04: prompt do banco — zero hardcode
        );
        return JSON.stringify(result);
      },
      {
        name: qualifyLeadTool.name,
        description: qualifyLeadTool.description,
        schema: qualifyLeadTool.schema,
      }
    );

    // D-04 (Fase 12): bound com closure sobre ctx.sql — injetado pelo BrainRunner (sempre presente para brain-sdr)
    // ctx.sql! é seguro: index.ts passa sql no construtor do BrainRunner (linha 67)
    const boundPauseSessionTool = createPauseSessionTool(ctx.sql!);
    const boundFinishConversationTool = createFinishConversationTool(ctx.sql!);

    // CRITICAL: bindTools() com [boundQualifyTool] — não ctx.tools
    // ctx.tools vem do ToolsRegistry e contém qualifyLeadTool sem closure;
    // usar boundQualifyTool garante que o prompt do banco é injetado.
    // BaseChatModel.bindTools é opcional na tipagem — guard de runtime garante provider com tool calling
    if (!ctx.llm.bindTools) {
      throw new Error("LLM provider não suporta tool calling — configure um provider compatível (ex: OpenAI, Anthropic, Gemini)");
    }
    // D-08 (Fase 12): bind com 3 tools nativas + MCP tools injetadas (MCP-02, D-03)
    // ctx.mcpTools é sempre array (D-02) — [] quando MCP_URL ausente (sem impacto no comportamento)
    const llmWithTools = ctx.llm.bindTools([
      boundQualifyTool,
      boundPauseSessionTool,
      boundFinishConversationTool,
      ...ctx.mcpTools,  // D-03: MCP tools injetadas pelo BrainRunner; [] quando MCP_URL ausente (D-02)
    ]);

    // HIST-03: context window — slice feito no nó, não no invoke() (Pitfall 3 do runner.ts)
    const getContextWindow = (): number => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40; // SECURITY: T-08-ENV
    };

    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // D-04: system prompt via ctx.prompts["system"] — zero hardcode (SDR-04)
        const messagesForLLM = state.messages.slice(-getContextWindow());
        const response = await llmWithTools.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);
        // D-09 (Fase 12): setar brainOutput — mesmo padrão do brain-echo
        // ATENÇÃO: messages: [response] sem spread — brain-sdr usa ReAct; append reducer adiciona ao histórico
        const fullResponse = typeof response.content === "string" ? response.content : "";
        return {
          messages: [response],
          brainOutput: { fullResponse, responseMode: "text" as const },
          tokenUsage: extractTokenUsage(response),  // D-07: delta do LLM call atual
        };
      })
      // D-07 (Fase 12): ToolNode com 3 tools nativas + MCP tools (MCP-02, D-03)
      // D-11, MCP-04: handleToolErrors: true — captura erro de MCP tool, injeta ToolMessage — evita thread corrompido (PITFALL-2)
      .addNode("tools", new ToolNode(
        [boundQualifyTool, boundPauseSessionTool, boundFinishConversationTool, ...ctx.mcpTools],
        { handleToolErrors: true }
      ))
      .addEdge("__start__", "llm")
      // D-02: toolsCondition verifica tool_calls no último AIMessage — roteia para tools ou __end__
      .addConditionalEdges("llm", toolsCondition, ["tools", "__end__"])
      .addEdge("tools", "llm");
    // NUNCA chamar compile() aqui — BrainRunner._compileGraph() é responsável
  },
};
