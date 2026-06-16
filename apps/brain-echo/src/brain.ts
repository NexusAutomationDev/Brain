// D-01: EchoBrain usa LLM real + system prompt carregado da tabela `prompts`
// D-02: tools = [] — sem tools na fase de validação
// D-03: buildGraph() retorna StateGraph NÃO compilado — BrainRunner chama .compile({ checkpointer })

import { StateGraph } from "@langchain/langgraph";
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
    // Return type: `any` necessário porque StateGraph acumula tipos de nós via generics
    // e o tipo inferido após addNode("llm") não é assignable ao StateGraph<typeof BrainStateAnnotation>
    // sem os parâmetros genéricos extras (N, I, O, etc). Em runtime o tipo é correto.
    return new StateGraph(BrainStateAnnotation)
      .addNode("llm", async (state) => {
        // D-01: system prompt carregado de ctx.prompts['system'] (nunca hardcoded)
        // D-03: ctx.llm já configurado pelo BrainRunner — não criar LLM aqui

        // HIST-03: Limitar mensagens enviadas ao LLM — histórico completo fica no PostgresSaver
        // D-05: Slice aqui (no nó), não no invoke() do BrainRunner — evita duplicação de mensagens
        // O SystemMessage é construído inline (não faz parte de state.messages), então o slice é aplicado apenas no histórico
        const contextWindowSize = (() => {
          const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
          return n > 0 && isFinite(n) ? n : 40;  // SECURITY: T-08-ENV
        })();
        const messagesForLLM = state.messages.slice(-contextWindowSize);

        const response = await ctx.llm.invoke([
          { role: "system", content: ctx.prompts["system"] },
          ...messagesForLLM,
        ]);

        // SDK-06: D-07, D-08 — nó monta BrainOutput manualmente; sem .withStructuredOutput()
        const fullResponse =
          typeof response.content === "string" ? response.content : "";

        return {
          messages: [...state.messages, response],
          brainOutput: {
            fullResponse,
            responseMode: "text" as const,  // brain-echo é text-only em v1.2
          },
          tokenUsage: extractTokenUsage(response),  // D-07: delta do LLM call atual
        };
      })
      .addEdge("__start__", "llm")
      .addEdge("llm", "__end__");
  },
};
