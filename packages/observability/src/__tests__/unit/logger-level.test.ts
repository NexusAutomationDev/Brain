import { describe, test, expect } from "bun:test";
import { resolve } from "path";

// quick-260728-tjb: LOG_LEVEL malformado derrubava o container inteiro.
// Produção parou com `error: default level:=info must be included in custom levels`
// vindo do construtor do pino, disparado por `LOG_LEVEL==info` no compose (valor "=info").
// createLogger() roda em import time (ex.: packages/ai/src/llm/fallback.ts:4), então o
// processo morria antes de qualquer log útil sair.
//
// Os testes rodam em SUBPROCESSO de propósito: vários arquivos desta suíte fazem
// mock.module("@brain-pkg/observability", ...), e no run completo essa poluição global
// substituiria createLogger por um stub sem `.level`. Um processo separado exercita o
// código real e reproduz exatamente a condição de boot do container.

const LOGGER_PATH = resolve(import.meta.dir, "../../logger.ts");

/** Sobe um processo isolado com o LOG_LEVEL dado e devolve saída + código de saída. */
function runWithLogLevel(level: string | undefined): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (level === undefined) delete env.LOG_LEVEL;
  else env.LOG_LEVEL = level;

  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `const { createLogger } = await import(${JSON.stringify(LOGGER_PATH)});
       console.log("LEVEL:" + createLogger({ brainId: "test" }).level);`,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("createLogger — LOG_LEVEL inválido não derruba o processo", () => {
  test("REGRESSÃO: LOG_LEVEL='=info' (typo de compose) não mata o processo", () => {
    const r = runWithLogLevel("=info");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:info");
    // O valor recebido aparece no aviso — é o que permite achar o typo
    expect(r.stderr).toContain('"=info"');
  });

  test("valor inválido cai para info", () => {
    const r = runWithLogLevel("verboso");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:info");
  });

  test("string em branco cai para info", () => {
    const r = runWithLogLevel("   ");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:info");
  });

  test("ENV ausente cai para info", () => {
    const r = runWithLogLevel(undefined);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:info");
  });

  test("nível válido é respeitado", () => {
    const r = runWithLogLevel("debug");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:debug");
  });

  test("nível válido é normalizado (case e espaços)", () => {
    const r = runWithLogLevel("  WARN ");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("LEVEL:warn");
  });
});
