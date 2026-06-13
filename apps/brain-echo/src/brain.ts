// D-01: EchoBrain usa LLM real + system prompt carregado da tabela `prompts`
// D-02: tools = [] — sem tools na fase de validação
// D-03: buildGraph() retorna StateGraph NÃO compilado — BrainRunner chama .compile({ checkpointer })

import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "@brain-pkg/ai";
import type { IBrain, BrainBuildContext } from "@brain-pkg/core";

export const echoBrain: IBrain = {
  id: "brain-echo",
  brainType: "echo",
  promptKeys: ["system"],
  tools: [],
  buildGraph(ctx: BrainBuildContext) {
    const graph = new StateGraph(BrainStateAnnotation);

    graph.addNode("llm", async (state) => {
      // D-01: system prompt carregado de ctx.prompts['system'] (nunca hardcoded)
      // D-03: ctx.llm já configurado pelo BrainRunner — não criar LLM aqui
      const response = await ctx.llm.invoke([
        { role: "system", content: ctx.prompts["system"] },
        ...state.messages,
      ]);
      return { messages: [...state.messages, response] };
    });

    graph.addEdge("__start__", "llm");
    graph.addEdge("llm", "__end__");

    // D-03: NUNCA chamar .compile() aqui — BrainRunner é o responsável
    return graph;
  },
};
