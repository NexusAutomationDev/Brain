import { describe, test, expect, mock } from "bun:test";

describe("EchoBrain — IBrain contract", () => {
  test("placeholder: arquivo existe e é parseável", () => {
    expect(true).toBe(true);
  });

  test("echoBrain.id é 'brain-echo'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.echoBrain.id).toBe("brain-echo");
  });

  test("echoBrain.brainType é 'echo'", async () => {
    const mod = await import("../../brain.js");
    expect(mod.echoBrain.brainType).toBe("echo");
  });

  test("echoBrain.promptKeys contém ['system']", async () => {
    const mod = await import("../../brain.js");
    expect(mod.echoBrain.promptKeys).toEqual(["system"]);
  });

  test("echoBrain.tools é array vazio", async () => {
    const mod = await import("../../brain.js");
    expect(mod.echoBrain.tools).toEqual([]);
  });

  test("buildGraph(ctx) retorna StateGraph (tem método addNode)", async () => {
    const mod = await import("../../brain.js");
    // Mock mínimo de BrainBuildContext
    const ctx = {
      llm: { invoke: mock(async () => ({ content: "ok" })) },
      prompts: { system: "Você é um assistente útil." },
      tools: [],
    };
    const graph = mod.echoBrain.buildGraph(ctx as any);
    // StateGraph retorna objeto com métodos de grafo — não deve ser null
    expect(graph).toBeTruthy();
    expect(typeof graph.addNode).toBe("function");
    expect(typeof graph.compile).toBe("function");
  });
});
