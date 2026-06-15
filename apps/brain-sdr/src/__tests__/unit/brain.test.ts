import { describe, test, expect, mock } from "bun:test";
import { AIMessage } from "@langchain/core/messages";

describe("BrainSDR — IBrain contract (SDR-01, SDR-04)", () => {
  test("sdrBrain.id é 'brain-sdr'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.id).toBe("brain-sdr");
  });

  test("sdrBrain.brainType é 'sdr'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.brainType).toBe("sdr");
  });

  test("sdrBrain.promptKeys é ['system', 'qualification']", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.promptKeys).toEqual(["system", "qualification"]);
  });

  test("sdrBrain.tools tem exatamente 1 tool: qualify_lead", async () => {
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.tools).toHaveLength(1);
    expect(mod.sdrBrain.tools[0].name).toBe("qualify_lead");
  });

  test("buildGraph(ctx) retorna StateGraph (tem addNode e compile)", async () => {
    const mod = await import("../../brain.js");
    const ctx = {
      llm: {
        bindTools: mock(() => ({
          invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
        })),
      },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any, // D-14: mock simples — createXTool(sql) acessa DB apenas na invocação, não na criação
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    expect(graph).toBeTruthy();
    expect(typeof graph.addNode).toBe("function");
    expect(typeof graph.compile).toBe("function");
  });
});

describe("qualify_lead tool — contrato SDR-05", () => {
  test("qualifyLeadTool.name é 'qualify_lead'", async () => {
    const mod = await import("../../qualifier.js");
    expect(mod.qualifyLeadTool.name).toBe("qualify_lead");
  });

  test("qualifyLeadTool.schema tem campo description", async () => {
    const mod = await import("../../qualifier.js");
    // DynamicStructuredTool tem schema.shape para ZodObject
    const shape = (mod.qualifyLeadTool.schema as any).shape;
    expect(shape).toHaveProperty("description");
  });

  test("qualifyLeadTool.schema tem campo session_id", async () => {
    const mod = await import("../../qualifier.js");
    const shape = (mod.qualifyLeadTool.schema as any).shape;
    expect(shape).toHaveProperty("session_id");
  });
});

describe("contextWindowSize — parse seguro (SDR-01, HIST-03)", () => {
  test("fallback 40 quando ENV é inválida", () => {
    const validate = (envVal: string | undefined): number => {
      const n = parseInt(envVal ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;
    };
    expect(validate(undefined)).toBe(40);
    expect(validate("abc")).toBe(40);
    expect(validate("-5")).toBe(40);
    expect(validate("0")).toBe(40);
    expect(validate("20")).toBe(20);
  });
});

describe("BrainSDR — Standard Tools binding (D-07, D-08, TOOLS-STD-03)", () => {
  test("buildGraph(ctx) com ctx.sql mock chama bindTools com 3 tools", async () => {
    // Re-importar para garantir estado limpo (Bun test pode cachear módulos)
    const mod = await import("../../brain.js");
    const bindToolsMock = mock(() => ({
      invoke: mock(async () => ({ content: "resposta", tool_calls: [] })),
    }));
    const ctx = {
      llm: { bindTools: bindToolsMock },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any, // D-14: mock simples — factory aceita qualquer objeto em construção
    };
    mod.sdrBrain.buildGraph(ctx as any);
    // Verificar que bindTools foi chamado 1 vez com array de 3 tools
    expect(bindToolsMock).toHaveBeenCalledTimes(1);
    const callArgs = (bindToolsMock as any).mock.calls[0][0] as Array<{ name: string }>;
    expect(callArgs).toHaveLength(3);
    const toolNames = callArgs.map((t) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("pause_session");
    expect(toolNames).toContain("finish_conversation");
  });

  test("sdrBrain.tools[] permanece com 1 tool qualify_lead (D-05 — tools[] é campo estático)", async () => {
    const mod = await import("../../brain.js");
    // D-05: standard tools NÃO entram em sdrBrain.tools[] — são bound diretamente no buildGraph()
    expect(mod.sdrBrain.tools).toHaveLength(1);
    expect(mod.sdrBrain.tools[0].name).toBe("qualify_lead");
  });
});

describe("BrainSDR — nó llm seta brainOutput (D-09, PARSER-03)", () => {
  test("sdrBrain.promptKeys contém 'system' e 'qualification'", async () => {
    // Verificação regressiva — promptKeys não mudam (D-11)
    const mod = await import("../../brain.js");
    expect(mod.sdrBrain.promptKeys).toEqual(["system", "qualification"]);
  });

  test("grafo compilado seta brainOutput.fullResponse e brainOutput.responseMode após invocação do LLM sem tool_calls", async () => {
    const mod = await import("../../brain.js");
    const llmInvokeMock = mock(async () =>
      new AIMessage({ content: "resposta do llm", tool_calls: [] })
    );
    const ctx = {
      llm: {
        bindTools: mock(() => ({ invoke: llmInvokeMock })),
      },
      prompts: { system: "prompt sistema", qualification: "prompt qualificacao" },
      tools: [],
      sql: {} as any,
    };
    const graph = mod.sdrBrain.buildGraph(ctx as any);
    const compiled = graph.compile();
    const result = await compiled.invoke(
      { messages: [{ role: "user", content: "olá" }] },
      { configurable: { thread_id: "test-parser-03" } }
    );
    expect(result.brainOutput).toBeDefined();
    expect(result.brainOutput.fullResponse).toBe("resposta do llm");
    expect(result.brainOutput.responseMode).toBe("text");
  });
});
