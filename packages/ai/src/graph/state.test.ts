import { describe, it, expect } from "bun:test";
import { BrainStateAnnotation } from "./state.js";
import type { BrainState } from "./state.js";
import { HumanMessage } from "@langchain/core/messages";
import { StateGraph } from "@langchain/langgraph";

describe("BrainStateAnnotation (AI-03)", () => {
  it("state schema contains schema_version field", () => {
    const state = BrainStateAnnotation.spec;
    expect("schema_version" in state).toBe(true);
  });

  it("state schema contains messages field", () => {
    const state = BrainStateAnnotation.spec;
    expect("messages" in state).toBe(true);
  });

  it("state schema contains userId and sessionId fields", () => {
    const state = BrainStateAnnotation.spec;
    expect("userId" in state).toBe(true);
    expect("sessionId" in state).toBe(true);
  });

  it("schema_version uses last-write-wins reducer", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("set_version", (_state) => ({ schema_version: 42 }))
      .addEdge("__start__", "set_version")
      .addEdge("set_version", "__end__")
      .compile();

    const result = await graph.invoke({ schema_version: 1 });
    expect(result.schema_version).toBe(42);
  });

  it("messages reducer accumulates (messagesStateReducer)", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("add_msg", (_state) => ({
        messages: [new HumanMessage("hello")],
      }))
      .addEdge("__start__", "add_msg")
      .addEdge("add_msg", "__end__")
      .compile();

    const result = await graph.invoke({ messages: [] });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("hello");
  });

  it("BrainState type is exported", () => {
    // TypeScript compile-time check: if BrainState is not exported, this import would fail
    const _typeCheck: BrainState = {
      schema_version: 1,
      messages: [],
      userId: "u1",
      sessionId: "s1",
      leadName: "",
      brainOutput: null,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    expect(_typeCheck.schema_version).toBe(1);
  });

  it("state schema contains tokenUsage field", () => {
    const state = BrainStateAnnotation.spec;
    expect("tokenUsage" in state).toBe(true);
  });

  it("TOK-03b: default tokenUsage is zeros (not null)", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("noop", (_state) => ({}))
      .addEdge("__start__", "noop")
      .addEdge("noop", "__end__")
      .compile();
    const result = await graph.invoke({ messages: [] });
    expect(result.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it("TOK-03c: reducer sums tokenUsage across two llm node passes (D-06)", async () => {
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
    expect(result2.tokenUsage.inputTokens).toBe(300);
    expect(result2.tokenUsage.outputTokens).toBe(130);
    expect(result2.tokenUsage.totalTokens).toBe(430);
  });
});
