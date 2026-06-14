import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

// Gap 9-02-02: PostgresSaver.getTuple() sem setup(); fallback em erro (SDR-05)

describe("runQualificationAgent — fallback quando DATABASE_URL ausente (SDR-05)", () => {
  test("retorna objeto fallback válido quando DATABASE_URL não está definida", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { runQualificationAgent } = await import("../../qualifier.js");
      const result = await runQualificationAgent("Lead interessado no produto", "session-unit-001");
      expect(result.qualificado).toBe(false);
      expect(typeof result.motivo).toBe("string");
      expect(result.motivo.length).toBeGreaterThan(0);
      expect(typeof result.proximo_passo).toBe("string");
      expect(result.proximo_passo.length).toBeGreaterThan(0);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe("qualifier.ts — análise estática de anti-patterns (Pitfall 4, SDR-05)", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../qualifier.ts"), "utf-8");
  // Exclui linhas de comentário para evitar falsos positivos em anotações de anti-pattern
  const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  test("não chama saver.setup() — tabelas pré-existem do BrainRunner.init() (Pitfall 4)", () => {
    expect(codeLines).not.toMatch(/\.setup\(\)/);
  });

  test("usa PostgresSaver.fromConnString() (factory estático, sem new)", () => {
    expect(codeLines).toMatch(/PostgresSaver\.fromConnString/);
  });

  test("usa _getType() em vez de instanceof para discriminar mensagens", () => {
    expect(codeLines).toMatch(/_getType\(\)/);
    expect(codeLines).not.toMatch(/instanceof AIMessage/);
    expect(codeLines).not.toMatch(/instanceof HumanMessage/);
  });

  test("tuple undefined tratado com fallback gracioso (?? [])", () => {
    expect(codeLines).toMatch(/\?\? \[\]/);
  });

  test("try/catch em volta do bloco PostgresSaver garante fallback em qualquer erro", () => {
    expect(codeLines).toMatch(/catch.*err.*\{/s);
    expect(codeLines).toMatch(/return fallback/);
  });
});
