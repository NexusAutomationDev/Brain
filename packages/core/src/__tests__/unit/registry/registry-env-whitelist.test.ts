// TECH-01: ToolsRegistry.getEnvWhitelist() — expõe envWhitelist para injeção em BrainBuildContext.
// Test 4: ctx.enabledTools = this.toolsRegistry.getEnvWhitelist() está coberto pelos
// integration tests do BrainRunner em packages/core/src/runner/__tests__/brain-runner.integration.test.ts.
// O teste unitário aqui cobre apenas o getter isolado — suficiente para validar TECH-01 na camada de registry.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ToolsRegistry } from "../../../tools/registry.js";

describe("ToolsRegistry.getEnvWhitelist() — TECH-01", () => {
  let originalBrainTools: string | undefined;

  beforeEach(() => {
    originalBrainTools = process.env.BRAIN_TOOLS;
  });

  afterEach(() => {
    if (originalBrainTools === undefined) {
      delete process.env.BRAIN_TOOLS;
    } else {
      process.env.BRAIN_TOOLS = originalBrainTools;
    }
  });

  // Test 1: BRAIN_TOOLS não setado → getEnvWhitelist() retorna null
  test("BRAIN_TOOLS não setado → getEnvWhitelist() retorna null (sem filtro)", () => {
    delete process.env.BRAIN_TOOLS;
    const registry = new ToolsRegistry();
    expect(registry.getEnvWhitelist()).toBeNull();
  });

  // Test 2: BRAIN_TOOLS="qualify_lead,search_knowledge" → retorna Set com ambos os nomes
  test('BRAIN_TOOLS="qualify_lead,search_knowledge" → getEnvWhitelist() retorna Set com ambos', () => {
    process.env.BRAIN_TOOLS = "qualify_lead,search_knowledge";
    const registry = new ToolsRegistry();
    const whitelist = registry.getEnvWhitelist();
    expect(whitelist).not.toBeNull();
    expect(whitelist).toBeInstanceOf(Set);
    expect(whitelist!.has("qualify_lead")).toBe(true);
    expect(whitelist!.has("search_knowledge")).toBe(true);
    expect(whitelist!.size).toBe(2);
  });

  // Test 3: BRAIN_TOOLS="" → getEnvWhitelist() retorna null (sem filtro — WR-02)
  test('BRAIN_TOOLS="" → getEnvWhitelist() retorna null (string vazia tratada como não setado)', () => {
    process.env.BRAIN_TOOLS = "";
    const registry = new ToolsRegistry();
    expect(registry.getEnvWhitelist()).toBeNull();
  });

  // Teste adicional: nomes com espaços são normalizados (trim aplicado)
  test("BRAIN_TOOLS com espaços extra → nomes normalizados no Set", () => {
    process.env.BRAIN_TOOLS = " qualify_lead , search_knowledge ";
    const registry = new ToolsRegistry();
    const whitelist = registry.getEnvWhitelist();
    expect(whitelist).not.toBeNull();
    expect(whitelist!.has("qualify_lead")).toBe(true);
    expect(whitelist!.has("search_knowledge")).toBe(true);
  });
});
