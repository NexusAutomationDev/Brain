import { describe, test, expect } from "bun:test";

// SDR-05: Integration — requer PostgreSQL real com dados de checkpoint
// Para executar: DATABASE_URL e DATABASE_NAME devem estar definidos no ambiente
// Os testes são skipped por padrão — rodar explicitamente com DB real

describe("qualify_lead — integração E2E (SDR-05)", () => {
  test.skip("runQualificationAgent retorna {qualificado, motivo, proximo_passo} dado sessionId com checkpoint", async () => {
    // Pré-condição: banco deve ter checkpoint do PostgresSaver para o sessionId
    // Este teste é executado manualmente com DB real após Plan 02 implementar qualifier.ts
    const { runQualificationAgent } = await import("../../qualifier.js");
    const result = await runQualificationAgent(
      "Lead demonstrou interesse em saber mais sobre o produto",
      "test-session-id-with-real-checkpoint"
    );
    expect(result).toHaveProperty("qualificado");
    expect(typeof result.qualificado).toBe("boolean");
    expect(result).toHaveProperty("motivo");
    expect(typeof result.motivo).toBe("string");
    expect(result).toHaveProperty("proximo_passo");
    expect(typeof result.proximo_passo).toBe("string");
  });

  test.skip("runQualificationAgent retorna fallback quando sessionId não tem checkpoint", async () => {
    // Comportamento esperado: retorno gracioso em vez de throw
    const { runQualificationAgent } = await import("../../qualifier.js");
    const result = await runQualificationAgent(
      "Contexto qualquer",
      "session-que-nao-existe-no-banco"
    );
    // Sem checkpoint: retorna objeto válido com qualificado=false
    expect(result.qualificado).toBe(false);
    expect(typeof result.motivo).toBe("string");
    expect(result.motivo.length).toBeGreaterThan(0);
  });
});

describe("Brain SDR — integração completa (SDR-01, SDR-02, SDR-03)", () => {
  test.skip("BrainRunner com BrainSDR processa mensagem de lead ativo e retorna reply", async () => {
    // Requer: DATABASE_URL, MIGRATIONS_FOLDER, LLM_PROVIDER API key configurados
    // Verifica: ia_ativada gate funciona + histórico persiste (herdado do BrainRunner)
    expect(true).toBe(true); // placeholder — implementar após Plan 03
  });
});
