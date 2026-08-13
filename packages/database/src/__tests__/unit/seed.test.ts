import { describe, it, expect, mock, beforeEach, beforeAll, afterAll, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- process.exit spy: runBrainSeed() must NEVER call it (throw-not-exit contract, SEED-05) ---
// Declared before the import of runBrainSeed so it is active for every test in this file.
const exitSpy = spyOn(process, 'exit').mockImplementation(((_code?: number) => {
  throw new Error('process.exit should never be called by runBrainSeed()');
}) as never);

afterAll(() => {
  exitSpy.mockRestore();
});

// --- sql/tx tagged-template mock — mirrors migrate.test.ts's mockSql/beginCalls pattern ---

let sqlCalls: string[] = [];
let beginCalls: string[] = [];
let unsafeCalls: string[] = [];
let beginCallCount = 0;

// Controls the D-08/D-09 validation SELECTs inside sql.begin(): happy path (non-empty) by default.
let fupConfigResult: unknown[] = [{ ok: 1 }];
let fupPromptResult: unknown[] = [{ ok: 1 }];
// Controls the FOR UPDATE NOWAIT tagged-template call: null = succeed; otherwise reject with this error.
let lockError: (Error & { code?: string }) | null = null;

function resetMocks() {
  sqlCalls = [];
  beginCalls = [];
  unsafeCalls = [];
  beginCallCount = 0;
  fupConfigResult = [{ ok: 1 }];
  fupPromptResult = [{ ok: 1 }];
  lockError = null;
}

const mockSql = mock(function (strings: TemplateStringsArray, ..._values: unknown[]) {
  const query = strings.raw[0]?.trim() ?? '';
  sqlCalls.push(query);
  return Promise.resolve([]);
}) as unknown as import('postgres').Sql;

// sql.begin(): executes the callback with a tx proxy that tracks calls in beginCalls,
// dispatches validation SELECTs based on strings.raw[0], and exposes tx.unsafe() to track
// the executed seed-file contents in order.
(mockSql as unknown as { begin: unknown }).begin = mock(
  async (cb: (tx: typeof mockSql) => Promise<unknown>) => {
    beginCallCount++;
    const txFn = mock(function (strings: TemplateStringsArray, ..._values: unknown[]) {
      const query = strings.raw[0]?.trim() ?? '';
      beginCalls.push(query);
      if (query.includes('FOR UPDATE NOWAIT')) {
        if (lockError) {
          return Promise.reject(lockError);
        }
        return Promise.resolve([{ id: 1 }]);
      }
      if (query.includes('SELECT 1 FROM fup_config')) {
        return Promise.resolve(fupConfigResult);
      }
      if (query.includes('SELECT 1 FROM prompts')) {
        return Promise.resolve(fupPromptResult);
      }
      return Promise.resolve([]);
    }) as unknown as typeof mockSql & { unsafe: unknown };
    (txFn as unknown as { unsafe: unknown }).unsafe = mock(async (content: string) => {
      unsafeCalls.push(content);
      return [];
    });
    return cb(txFn);
  },
);

// Import after mocks (bun hoisting requirement — mirrors migrate.test.ts convention)
import { runBrainSeed } from '../../seed.js';

// --- Real temp directory with real fixture .sql files (NOT mocking fs/fs-promises, per
// STATE.md Known Pitfalls: mock.module() is process-global) ---

let fixtureDir: string;
const BRAIN_TYPE = 'sdr-test';

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'brain-seed-test-'));
  // Intentionally out of lexical order on disk — readdir()+sort() inside runBrainSeed()
  // must still execute them in filename order (0001 before 0002).
  await writeFile(join(fixtureDir, '0002_second.sql'), "INSERT INTO foo VALUES ('second');");
  await writeFile(join(fixtureDir, '0001_first.sql'), "INSERT INTO foo VALUES ('first');");
  // Non-.sql file must be ignored by the readdir()+filter(".sql") logic.
  await writeFile(join(fixtureDir, 'README.txt'), 'not a seed file');
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetMocks();
});

describe('runBrainSeed() — bootstrap + lock reuse (D-09: same _schema_lock as runMigrations())', () => {
  it('cria _schema_lock com CREATE TABLE IF NOT EXISTS antes do retry loop', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    const createTableFound = sqlCalls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS _schema_lock'));
    expect(createTableFound).toBe(true);
  });

  it('insere row id=1 com ON CONFLICT DO NOTHING antes do retry loop', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    const insertFound = sqlCalls.some(
      (q) => q.includes('INSERT INTO _schema_lock') && q.includes('ON CONFLICT'),
    );
    expect(insertFound).toBe(true);
  });

  it('adquire lock com FOR UPDATE NOWAIT dentro de sql.begin()', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    const lockInBegin = beginCalls.some((q) => q.includes('FOR UPDATE NOWAIT'));
    expect(lockInBegin).toBe(true);
  });

  it('não usa pg_advisory_lock em nenhum momento', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    const usesAdvisory = sqlCalls.some((q) => q.includes('pg_advisory_lock'));
    expect(usesAdvisory).toBe(false);
  });
});

describe('runBrainSeed() — executa arquivos de seed em ordem, via tx.unsafe()', () => {
  it('executa cada arquivo .sql do seedsFolder, ordenado por nome, ignorando arquivos não-.sql', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    expect(unsafeCalls).toEqual([
      "INSERT INTO foo VALUES ('first');",
      "INSERT INTO foo VALUES ('second');",
    ]);
  });
});

describe("runBrainSeed() — D-08/D-09: fail-fast validation após executar os seeds", () => {
  it("lança erro nomeando o brainType quando a validação de fup_config retorna vazio", async () => {
    fupConfigResult = [];

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow(
      new RegExp(`fup_config.*${BRAIN_TYPE}`),
    );
  });

  it("lança erro nomeando o brainType quando a validação de prompts(key='fup') retorna vazio", async () => {
    fupPromptResult = [];

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow(
      new RegExp(`prompts.*${BRAIN_TYPE}|fup.*${BRAIN_TYPE}`),
    );
  });

  it('um erro de validação NÃO é retentado — propaga na primeira tentativa, sem 2ª chamada a sql.begin()', async () => {
    fupConfigResult = [];

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow();
    expect(beginCallCount).toBe(1);
  });
});

describe('runBrainSeed() — retry de lock (55P03), mesmo comportamento de runMigrations()', () => {
  it('retenta até 3 tentativas quando o lock (55P03) falha nas duas primeiras e sucede na terceira', async () => {
    let calls = 0;
    const originalBegin = (mockSql as unknown as { begin: (cb: (tx: typeof mockSql) => Promise<unknown>) => Promise<unknown> }).begin;
    // Override just for this test: fail lock on attempts 1-2, succeed on attempt 3.
    (mockSql as unknown as { begin: unknown }).begin = mock(
      async (cb: (tx: typeof mockSql) => Promise<unknown>) => {
        calls++;
        beginCallCount++;
        const shouldFailLock = calls < 3;
        const txFn = mock(function (strings: TemplateStringsArray, ..._values: unknown[]) {
          const query = strings.raw[0]?.trim() ?? '';
          beginCalls.push(query);
          if (query.includes('FOR UPDATE NOWAIT')) {
            if (shouldFailLock) {
              const err = new Error('lock not available') as Error & { code: string };
              err.code = '55P03';
              return Promise.reject(err);
            }
            return Promise.resolve([{ id: 1 }]);
          }
          if (query.includes('SELECT 1 FROM fup_config')) return Promise.resolve(fupConfigResult);
          if (query.includes('SELECT 1 FROM prompts')) return Promise.resolve(fupPromptResult);
          return Promise.resolve([]);
        }) as unknown as typeof mockSql & { unsafe: unknown };
        (txFn as unknown as { unsafe: unknown }).unsafe = mock(async (content: string) => {
          unsafeCalls.push(content);
          return [];
        });
        return cb(txFn);
      },
    );

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).resolves.toBeUndefined();
    expect(calls).toBe(3);

    // Restore the module-level begin mock for subsequent tests
    (mockSql as unknown as { begin: unknown }).begin = originalBegin;
  });

  it('lança erro descritivo de lock após esgotar as 3 tentativas', async () => {
    lockError = Object.assign(new Error('lock not available'), { code: '55P03' });

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow(
      /lock/i,
    );
    expect(beginCallCount).toBe(3);
  });

  it('outros erros de código diferente de 55P03 propagam imediatamente, sem retry', async () => {
    lockError = Object.assign(new Error('some other db error'), { code: '42601' });

    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow('some other db error');
    expect(beginCallCount).toBe(1);
  });
});

describe('runBrainSeed() — throw-not-exit contract (SEED-05 philosophy, mesmo de runMigrations())', () => {
  it('nunca chama process.exit — nem no caminho feliz, nem em erro de validação, nem em erro de lock', async () => {
    await runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir);

    fupConfigResult = [];
    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow();

    resetMocks();
    lockError = Object.assign(new Error('lock not available'), { code: '55P03' });
    await expect(runBrainSeed(mockSql, BRAIN_TYPE, fixtureDir)).rejects.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEED-05: as 3 migrations de seed existentes permanecem intocadas por esta fase.
// Convenção de leitura de arquivo real (import.meta.dir), mesma de migration-v14.test.ts —
// sem mockar fs/fs-promises aqui.
// ─────────────────────────────────────────────────────────────────────────────
describe('SEED-05: existing seed migrations untouched', () => {
  const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');

  it('0002_echo_brain_seed.sql ainda contém os markers originais', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0002_echo_brain_seed.sql'), 'utf-8');
    expect(sql).toContain("'echo'");
    expect(sql).toContain('ON CONFLICT (brain_type, key) DO NOTHING');
  });

  it('0005_brain_sdr_prompts.sql ainda contém os markers originais', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0005_brain_sdr_prompts.sql'), 'utf-8');
    expect(sql).toContain("'sdr'");
    expect(sql).toContain("'qualification'");
  });

  it('0010_brain_support_prompts.sql ainda contém o marker original', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0010_brain_support_prompts.sql'), 'utf-8');
    expect(sql).toContain("'support'");
  });
});
