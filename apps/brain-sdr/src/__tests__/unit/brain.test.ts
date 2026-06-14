import { describe, test, expect, mock } from "bun:test";

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
