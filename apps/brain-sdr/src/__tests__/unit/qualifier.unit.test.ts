import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

// Gap 9-02-02: PostgresSaver.getTuple() sem setup(); fallback em erro (SDR-05)

describe("runQualificationAgent — falha técnica devolve null, não false (quick-260728-suj)", () => {
  test("qualificado é null (não false) quando DATABASE_URL não está definida", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { runQualificationAgent } = await import("../../qualifier.js");
      const result = await runQualificationAgent("Lead interessado no produto", "session-unit-001");
      // null = não foi possível analisar. `false` significaria lead desqualificado,
      // um veredito que ninguém emitiu.
      expect(result.qualificado).toBeNull();
      expect(typeof result.motivo).toBe("string");
      expect(result.motivo.length).toBeGreaterThan(0);
      expect(typeof result.proximo_passo).toBe("string");
      expect(result.proximo_passo.length).toBeGreaterThan(0);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe("serializeQualificationResult — marcador de erro na ToolMessage", () => {
  test("qualificado null produz payload com status 'error'", async () => {
    const { serializeQualificationResult } = await import("../../qualifier.js");
    const payload = JSON.parse(
      serializeQualificationResult({
        qualificado: null,
        motivo: "Falha técnica",
        proximo_passo: "Continue a conversa",
      })
    );
    expect(payload.status).toBe("error");
    expect(payload.qualificado).toBeNull();
  });

  test("qualificado false NÃO carrega status — payload de sucesso inalterada", async () => {
    const { serializeQualificationResult } = await import("../../qualifier.js");
    const payload = JSON.parse(
      serializeQualificationResult({
        qualificado: false,
        motivo: "Lead sem orçamento",
        proximo_passo: "Encerrar cordialmente",
      })
    );
    // Compatibilidade: consumidores já integrados ao webhook não veem campo novo
    expect(payload).not.toHaveProperty("status");
    expect(payload.qualificado).toBe(false);
  });

  test("qualificado true NÃO carrega status", async () => {
    const { serializeQualificationResult } = await import("../../qualifier.js");
    const payload = JSON.parse(
      serializeQualificationResult({
        qualificado: true,
        motivo: "Lead com fit e orçamento",
        proximo_passo: "Agendar reunião",
      })
    );
    expect(payload).not.toHaveProperty("status");
    expect(payload.qualificado).toBe(true);
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

describe("CR-01: PostgresSaver connection leak — saver.end() em finally", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../qualifier.ts"), "utf-8");
  // Excluir linhas de comentário para evitar falsos positivos
  const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  test("qualifier.ts contém saver.end() para fechar o pg.Pool interno (CR-01)", () => {
    expect(codeLines).toMatch(/saver\.end\(\)/);
  });

  test("saver.end() está em bloco finally (não no fluxo normal)", () => {
    // Verificar que 'finally' aparece no contexto do saver
    expect(codeLines).toMatch(/finally\s*\{[^}]*saver\.end\(\)/s);
  });

  test("saver.end() é chamado APÓS saver.getTuple() (Pitfall 5: não fechar antes de usar)", () => {
    const getTupleIdx = codeLines.indexOf("saver.getTuple(");
    const endIdx = codeLines.indexOf("saver.end()");
    expect(getTupleIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(getTupleIdx);
  });

  test("saver.end() usa API pública tipada — sem cast (saver as any) na chamada end()", () => {
    // Verificar que a linha com saver.end() não tem cast de tipo
    const lines = src.split("\n");
    const endLine = lines.find(l => l.includes("saver.end()") && !l.trim().startsWith("//"));
    expect(endLine).toBeDefined();
    expect(endLine).not.toMatch(/as any/);
  });
});

describe("PGB-TD01: prepare: false em saveQualificationToMemories", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../qualifier.ts"), "utf-8");
  // Excluir linhas de comentario para evitar falsos positivos
  const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  test("postgres() em saveQualificationToMemories passa prepare: false (PgBouncer transaction mode)", () => {
    // Mesmo padrao de PGB-05 em migrate.test.ts (linhas 126-132)
    const hasPrepare = /postgres\(dbUrl,\s*\{[^}]*prepare:\s*false/.test(codeLines);
    expect(hasPrepare).toBe(true);
  });
});

describe("quick-260728-suj: memories não é sobrescrito por falha de qualificação", () => {
  const src = readFileSync(resolve(import.meta.dir, "../../qualifier.ts"), "utf-8");
  const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  test("saveQualificationToMemories está sob guard de qualificado !== null", () => {
    // O UPSERT usa ON CONFLICT DO UPDATE — gravar uma falha apagaria a qualificação anterior
    expect(codeLines).toMatch(
      /if\s*\(\s*finalResult\.qualificado\s*!==\s*null\s*\)\s*\{[\s\S]*?saveQualificationToMemories\(/
    );
  });
});
