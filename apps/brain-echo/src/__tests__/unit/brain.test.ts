// Wave 0 stub — IBrain contract tests for EchoBrain
// Stubs criados antes da implementação (Nyquist compliance)
// Implementação completa ocorre no plano 04-02 (Wave 1)

import { describe, test, expect } from "bun:test";

describe("EchoBrain — IBrain contract", () => {
  test("placeholder: arquivo existe e é parseável", () => {
    expect(true).toBe(true);
  });

  test.todo("echoBrain.id é 'brain-echo'");
  test.todo("echoBrain.brainType é 'echo'");
  test.todo("echoBrain.promptKeys contém 'system'");
  test.todo("echoBrain.tools é array vazio");
  test.todo("echoBrain.buildGraph(ctx) retorna StateGraph não compilado");
  test.todo("buildGraph retorna objeto com método addNode (StateGraph interface)");
});
