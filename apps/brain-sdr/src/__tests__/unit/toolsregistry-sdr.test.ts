import { describe, test, expect } from "bun:test";
import { ToolsRegistry } from "@brain-pkg/core";
import type { StructuredTool } from "@langchain/core/tools";

// Minimal duck-typed mock tools — getTools() only checks .name against the whitelist
function makeMockTool(name: string): StructuredTool {
  return { name } as unknown as StructuredTool;
}

describe("ToolsRegistry — configuração brain-sdr (TOOLS-STD-03)", () => {
  test("getTools retorna as 3 tools quando registry está configurado como index.ts configura", () => {
    const registry = new ToolsRegistry();
    registry.enableTool("sdr", "qualify_lead");
    registry.enableTool("sdr", "pause_session");
    registry.enableTool("sdr", "finish_conversation");

    const mockTools = [
      makeMockTool("qualify_lead"),
      makeMockTool("pause_session"),
      makeMockTool("finish_conversation"),
    ];

    const result = registry.getTools("sdr", mockTools);

    expect(result).toHaveLength(3);
    const names = result.map((t) => t.name);
    expect(names).toContain("qualify_lead");
    expect(names).toContain("pause_session");
    expect(names).toContain("finish_conversation");
  });

  test("getTools não lança ConfigurationError quando brainType 'sdr' está registrado mas lista de tools é vazia", () => {
    const registry = new ToolsRegistry();
    registry.enableTool("sdr", "qualify_lead");
    registry.enableTool("sdr", "pause_session");
    registry.enableTool("sdr", "finish_conversation");

    // brainType está registrado — não deve lançar mesmo com lista vazia
    expect(() => registry.getTools("sdr", [])).not.toThrow();
    expect(registry.getTools("sdr", [])).toHaveLength(0);
  });

  test("getTools lança ConfigurationError quando brainType 'sdr' nunca foi registrado", () => {
    const registry = new ToolsRegistry();
    expect(() => registry.getTools("sdr", [])).toThrow();
  });
});
