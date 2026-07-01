import { describe, test, expect, mock } from "bun:test";
import { AIMessage } from "@langchain/core/messages";

describe("BrainSupport — IBrain contract (SUP-01, SUP-05)", () => {
  test("supportBrain.id é 'brain-support'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.supportBrain.id).toBe("brain-support");
  });

  test("supportBrain.brainType é 'support'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.supportBrain.brainType).toBe("support");
  });

  test("supportBrain.promptKeys é ['system'] (sem 'qualification' — D-06)", async () => {
    const mod = await import("../../brain.js");
    expect(mod.supportBrain.promptKeys).toEqual(["system"]);
  });

  test("supportBrain.tools tem exatamente 1 tool: search_knowledge (sem qualify_lead equivalent)", async () => {
    const mod = await import("../../brain.js");
    expect(mod.supportBrain.tools).toHaveLength(1);
    const toolNames = mod.supportBrain.tools.map((t: any) => t.name);
    expect(toolNames).toContain("search_knowledge");
  });
});

describe("BrainSupport — search_knowledge sempre ativa (D-04, SUP-02)", () => {
  test("buildGraph(ctx) com enabledTools=Set(['pause_session']) ainda inclui search_knowledge no bindTools — bypass do filtro", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => new AIMessage({ content: "resposta", tool_calls: [] })),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "prompt sistema" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
      enabledTools: new Set(["pause_session"]), // search_knowledge deliberadamente fora da whitelist
    };
    mod.supportBrain.buildGraph(ctx as any);
    expect(bindToolsMock).toHaveBeenCalledTimes(1);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    const toolNames = callArgs.map((t) => t.name);
    expect(toolNames).toContain("search_knowledge");
  });

  test("buildGraph(ctx) com enabledTools=null (BRAIN_TOOLS unset) chama bindTools com exatamente 4 tools, sem qualify_lead", async () => {
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => new AIMessage({ content: "resposta", tool_calls: [] })),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "prompt sistema" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
      enabledTools: null,
    };
    mod.supportBrain.buildGraph(ctx as any);
    expect(bindToolsMock).toHaveBeenCalledTimes(1);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(callArgs).toHaveLength(4);
    const toolNames = callArgs.map((t) => t.name);
    expect(toolNames).toContain("pause_session");
    expect(toolNames).toContain("finish_conversation");
    expect(toolNames).toContain("search_knowledge");
    expect(toolNames).toContain("respond");
    expect(toolNames).not.toContain("qualify_lead");
  });
});

describe("BrainSupport — contrato BrainOutput igual ao SDR (SUP-05)", () => {
  test("grafo compilado com LLM mock sem respond call seta brainOutput.responseMode como 'undefined' (fallback D-10)", async () => {
    const mod = await import("../../brain.js");
    const llmInvokeMock = mock(async () =>
      new AIMessage({ content: "resposta do llm", tool_calls: [] })
    );
    const ctx = {
      llm: { bindTools: mock(() => ({ invoke: llmInvokeMock })) },
      prompts: { system: "prompt sistema" },
      tools: [],
      sql: {} as any,
      mcpTools: [],
      enabledTools: null,
    };
    const graph = mod.supportBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    const result = await compiled.invoke(
      { messages: [{ role: "user", content: "olá" }] },
      { configurable: { thread_id: "test-support-parser" } }
    );
    expect(result.brainOutput).toBeDefined();
    expect(result.brainOutput.fullResponse).toBe("resposta do llm");
    expect(result.brainOutput.responseMode).toBe("undefined");
  });
});
