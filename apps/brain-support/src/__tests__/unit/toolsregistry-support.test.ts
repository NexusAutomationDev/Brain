import { describe, test, expect } from "bun:test";
import { ToolsRegistry } from "@brain-pkg/core";
import type { StructuredTool } from "@langchain/core/tools";

function makeMockTool(name: string): StructuredTool {
  return { name } as unknown as StructuredTool;
}

describe("ToolsRegistry — configuração brain-support (SUP-08)", () => {
  test("getTools retorna as 3 tools quando registry está configurado como index.ts configura", () => {
    const registry = new ToolsRegistry();
    registry.enableTool("support", "pause_session");
    registry.enableTool("support", "finish_conversation");
    registry.enableTool("support", "search_knowledge");

    const mockTools = [
      makeMockTool("pause_session"),
      makeMockTool("finish_conversation"),
      makeMockTool("search_knowledge"),
    ];

    const result = registry.getTools("support", mockTools);

    expect(result).toHaveLength(3);
    const names = result.map((t) => t.name);
    expect(names).toContain("pause_session");
    expect(names).toContain("finish_conversation");
    expect(names).toContain("search_knowledge");
    expect(names).not.toContain("qualify_lead");
  });

  test("getTools não lança ConfigurationError quando brainType 'support' está registrado mas lista de tools é vazia", () => {
    const registry = new ToolsRegistry();
    registry.enableTool("support", "pause_session");
    registry.enableTool("support", "finish_conversation");
    registry.enableTool("support", "search_knowledge");

    expect(() => registry.getTools("support", [])).not.toThrow();
    expect(registry.getTools("support", [])).toHaveLength(0);
  });

  test("getTools lança ConfigurationError quando brainType 'support' nunca foi registrado", () => {
    const registry = new ToolsRegistry();
    expect(() => registry.getTools("support", [])).toThrow();
  });

  test("BRAIN_TOOLS não afeta o registro de 'support' quando ausente — search_knowledge continua habilitada", () => {
    const originalBrainTools = process.env.BRAIN_TOOLS;
    delete process.env.BRAIN_TOOLS;
    try {
      const registry = new ToolsRegistry();
      registry.enableTool("support", "search_knowledge");
      const result = registry.getTools("support", [makeMockTool("search_knowledge")]);
      expect(result).toHaveLength(1);
    } finally {
      if (originalBrainTools === undefined) delete process.env.BRAIN_TOOLS;
      else process.env.BRAIN_TOOLS = originalBrainTools;
    }
  });
});
