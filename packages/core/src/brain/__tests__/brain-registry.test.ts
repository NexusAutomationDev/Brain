// SDK-01: BrainRegistry — register and resolve IBrain instances by ID
import { describe, test, expect } from "bun:test";
import { BrainRegistry } from "../registry.js";
import { ConfigurationError } from "@brain-pkg/shared";
import type { IBrain } from "../interface.js";

// Minimal IBrain stub for testing (no real LangGraph dependency needed)
function makeBrain(id: string, brainType = "test"): IBrain {
  return {
    id,
    brainType,
    promptKeys: [],
    tools: [],
    buildGraph: () => { throw new Error("not implemented in stub"); },
  } as unknown as IBrain;
}

describe("BrainRegistry", () => {
  test("register() stores an IBrain and resolve() returns it by id", () => {
    const registry = new BrainRegistry();
    const brain = makeBrain("brain-1");
    registry.register(brain);
    expect(registry.resolve("brain-1")).toBe(brain);
  });

  test("resolve() throws ConfigurationError when brain id is not registered", () => {
    const registry = new BrainRegistry();
    expect(() => registry.resolve("nonexistent")).toThrow(ConfigurationError);
    expect(() => registry.resolve("nonexistent")).toThrow("Brain not found: nonexistent");
  });

  test("register() throws ConfigurationError when same brain id is registered twice", () => {
    const registry = new BrainRegistry();
    const brain = makeBrain("brain-dup");
    registry.register(brain);
    expect(() => registry.register(brain)).toThrow(ConfigurationError);
    expect(() => registry.register(brain)).toThrow("Brain already registered: brain-dup");
  });
});
