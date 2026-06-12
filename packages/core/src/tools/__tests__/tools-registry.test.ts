// SDK-03: ToolsRegistry — enable/disable tools per brainType
import { describe, test, expect } from "bun:test";
import { ToolsRegistry } from "../registry.js";
import { ConfigurationError } from "@brain-pkg/shared";
import type { StructuredTool } from "@langchain/core/tools";

// Minimal StructuredTool stub for testing
function makeTool(name: string): StructuredTool {
  return { name } as unknown as StructuredTool;
}

describe("ToolsRegistry", () => {
  test("getTools() returns only tools enabled for a brainType", () => {
    const registry = new ToolsRegistry();
    const toolA = makeTool("toolA");
    const toolB = makeTool("toolB");
    registry.enableTool("echo", "toolA");
    const result = registry.getTools("echo", [toolA, toolB]);
    expect(result).toEqual([toolA]);
    expect(result).not.toContain(toolB);
  });

  test("getTools() returns empty array when brainType is registered but no tools enabled", () => {
    const registry = new ToolsRegistry();
    const toolA = makeTool("toolA");
    // Register brainType with one tool, then remove it
    registry.enableTool("empty-type", "toolA");
    registry.disableTool("empty-type", "toolA");
    const result = registry.getTools("empty-type", [toolA]);
    expect(result).toEqual([]);
  });

  test("getTools() throws ConfigurationError when brainType is not registered", () => {
    const registry = new ToolsRegistry();
    const toolA = makeTool("toolA");
    expect(() => registry.getTools("other", [toolA])).toThrow(ConfigurationError);
    expect(() => registry.getTools("other", [toolA])).toThrow("brainType not registered");
  });

  test("enableTool() adds a tool to the allowed set for a brainType", () => {
    const registry = new ToolsRegistry();
    const toolA = makeTool("toolA");
    registry.enableTool("echo", "toolA");
    expect(registry.getTools("echo", [toolA])).toContain(toolA);
  });

  test("disableTool() removes a tool from the allowed set for a brainType", () => {
    const registry = new ToolsRegistry();
    const toolA = makeTool("toolA");
    registry.enableTool("echo", "toolA");
    registry.disableTool("echo", "toolA");
    const result = registry.getTools("echo", [toolA]);
    expect(result).toEqual([]);
  });
});
