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
      brainOutput: null,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    expect(_typeCheck.schema_version).toBe(1);
  });

  it("state schema contains tokenUsage field", () => {
    const state = BrainStateAnnotation.spec;
    expect("tokenUsage" in state).toBe(true);
  });
});
