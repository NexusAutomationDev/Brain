import { describe, test, expect, afterEach } from "bun:test";

// quick-260728-tjb: LOG_LEVEL malformado derrubava o container inteiro.
// Produção parou com `error: default level:=info must be included in custom levels`
// vindo do construtor do pino, disparado por `LOG_LEVEL==info` no compose (valor "=info").
// createLogger() roda em import time (ex.: packages/ai/src/llm/fallback.ts:4), então o
// processo morria antes de qualquer log útil sair.

const savedLevel = process.env.LOG_LEVEL;

afterEach(() => {
  if (savedLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = savedLevel;
});

describe("createLogger — LOG_LEVEL inválido não derruba o processo", () => {
  test("REGRESSÃO: LOG_LEVEL='=info' (typo de compose) não lança", async () => {
    process.env.LOG_LEVEL = "=info";
    const { createLogger } = await import("../../logger.js");
    expect(() => createLogger({ brainId: "test" })).not.toThrow();
  });

  test("valor inválido cai para info", async () => {
    process.env.LOG_LEVEL = "verboso";
    const { createLogger } = await import("../../logger.js");
    expect(createLogger().level).toBe("info");
  });

  test("string vazia cai para info", async () => {
    process.env.LOG_LEVEL = "   ";
    const { createLogger } = await import("../../logger.js");
    expect(createLogger().level).toBe("info");
  });

  test("ENV ausente cai para info", async () => {
    delete process.env.LOG_LEVEL;
    const { createLogger } = await import("../../logger.js");
    expect(createLogger().level).toBe("info");
  });

  test("nível válido é respeitado", async () => {
    process.env.LOG_LEVEL = "debug";
    const { createLogger } = await import("../../logger.js");
    expect(createLogger().level).toBe("debug");
  });

  test("nível válido é normalizado (case e espaços)", async () => {
    process.env.LOG_LEVEL = "  WARN ";
    const { createLogger } = await import("../../logger.js");
    expect(createLogger().level).toBe("warn");
  });
});
