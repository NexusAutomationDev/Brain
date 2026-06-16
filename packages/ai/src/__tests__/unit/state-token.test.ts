import { describe, it, expect } from "bun:test";
import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "../../graph/state.js";

describe("BrainStateAnnotation.tokenUsage reducer (TOK-03)", () => {
  it("TOK-03a: tokenUsage field exists in spec", () => {
    expect("tokenUsage" in BrainStateAnnotation.spec).toBe(true);
  });

  it("TOK-03b: default tokenUsage is zeros (not null)", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("noop", (_state) => ({}))
      .addEdge("__start__", "noop")
      .addEdge("noop", "__end__")
      .compile();

    // LangGraph requires at least one field to trigger defaults for remaining fields
    const result = await graph.invoke({ messages: [] });
    expect(result.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it("TOK-03c: reducer sums tokenUsage across two llm node passes (D-06)", async () => {
    // Testa acumulação via reducer: dois nós llm somam seus tokens
    const graph2 = new StateGraph(BrainStateAnnotation)
      .addNode("llm1", (_state) => ({
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))
      .addNode("llm2", (_state) => ({
        tokenUsage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
      }))
      .addEdge("__start__", "llm1")
      .addEdge("llm1", "llm2")
      .addEdge("llm2", "__end__")
      .compile();

    const result2 = await graph2.invoke({});
    expect(result2.tokenUsage.inputTokens).toBe(300);   // 100 + 200
    expect(result2.tokenUsage.outputTokens).toBe(130);  // 50 + 80
    expect(result2.tokenUsage.totalTokens).toBe(430);   // 150 + 280
  });
});
