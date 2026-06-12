import { describe, it, expect } from "bun:test";
import { StateGraph, Annotation } from "@langchain/langgraph";

describe("Subgraph pattern (AI-02)", () => {
  it("compiled child graph can be used as a node in parent graph", async () => {
    // Child graph: adds 10 to a counter
    const ChildAnnotation = Annotation.Root({
      counter: Annotation<number>({ default: () => 0, reducer: (_, next) => next }),
    });
    const childGraph = new StateGraph(ChildAnnotation)
      .addNode("add_ten", (state) => ({ counter: state.counter + 10 }))
      .addEdge("__start__", "add_ten")
      .addEdge("add_ten", "__end__")
      .compile();

    // Parent graph: uses child graph as a node
    const ParentAnnotation = Annotation.Root({
      counter: Annotation<number>({ default: () => 0, reducer: (_, next) => next }),
    });
    const parentGraph = new StateGraph(ParentAnnotation)
      .addNode("child", childGraph)
      .addEdge("__start__", "child")
      .addEdge("child", "__end__")
      .compile();

    const result = await parentGraph.invoke({ counter: 5 });
    expect(result.counter).toBe(15);
  });

  it("parent graph receives result from child graph invocation", async () => {
    const SharedAnnotation = Annotation.Root({
      value: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
    });

    const childGraph = new StateGraph(SharedAnnotation)
      .addNode("transform", (_state) => ({ value: "child_result" }))
      .addEdge("__start__", "transform")
      .addEdge("transform", "__end__")
      .compile();

    const parentGraph = new StateGraph(SharedAnnotation)
      .addNode("invoke_child", childGraph)
      .addEdge("__start__", "invoke_child")
      .addEdge("invoke_child", "__end__")
      .compile();

    const result = await parentGraph.invoke({ value: "initial" });
    expect(result.value).toBe("child_result");
  });
});
