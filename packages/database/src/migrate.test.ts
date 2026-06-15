import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

// --- Mocks (declared before imports that use them — bun hoisting requirement) ---

// Track all template literal calls on the sql mock
const sqlCalls: string[] = [];
// Track calls made inside sql.begin()
const beginCalls: string[] = [];

// sql mock: handles tagged template literals (sql`...`) by extracting the first string part
const mockSql = mock(function (strings: TemplateStringsArray, ...values: unknown[]) {
  const query = strings.raw[0]?.trim() ?? '';
  sqlCalls.push(query);
  return Promise.resolve([]);
}) as unknown as import('postgres').Sql;

// Add sql.begin() support — executes callback passing a proxied tx to track inner calls
(mockSql as any).begin = mock(async (fn: (tx: typeof mockSql) => Promise<unknown>) => {
  // Proxy to record calls made inside the transaction
  const txProxy = new Proxy(mockSql, {
    apply(target, thisArg, args) {
      const strings = args[0] as TemplateStringsArray;
      const query = strings.raw[0]?.trim() ?? '';
      beginCalls.push(query);
      return Reflect.apply(target, thisArg, args);
    },
  });
  return fn(txProxy as typeof mockSql);
});

// drizzle mock returns a plain object (the db handle)
const mockDrizzle = mock(() => ({}));
mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: mockDrizzle,
}));

// migrate mock — records calls; can be made to throw per test
const mockMigrate = mock(async (_db: unknown, _opts: unknown) => {});
mock.module('drizzle-orm/postgres-js/migrator', () => ({
  migrate: mockMigrate,
}));

// Import after mocks
import { runMigrations } from './migrate.js';

// Helper to reset call log and mocks between tests
function resetCalls() {
  sqlCalls.length = 0;
  beginCalls.length = 0;
  mockMigrate.mockReset();
  mockMigrate.mockImplementation(async () => {});
  (mockSql as any).begin.mockClear();
}

// ─────────────────────────────────────────────────────────────────────────────
// PGB-02/PGB-03: row-lock via _schema_lock
// ─────────────────────────────────────────────────────────────────────────────
describe('runMigrations() — PGB-02/PGB-03: row-lock via _schema_lock', () => {
  beforeEach(resetCalls);

  it('cria _schema_lock com CREATE TABLE IF NOT EXISTS antes do sql.begin()', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    const createTableFound = sqlCalls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS _schema_lock'));
    const beginCallCount = (mockSql as any).begin.mock.calls.length;

    expect(createTableFound).toBe(true);
    expect(beginCallCount).toBeGreaterThanOrEqual(1);
  });

  it('insere row id=1 com ON CONFLICT DO NOTHING antes do sql.begin()', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    const insertFound = sqlCalls.some(
      (q) => q.includes('INSERT INTO _schema_lock') && q.includes('ON CONFLICT'),
    );

    expect(insertFound).toBe(true);
  });

  it('adquire lock com FOR UPDATE NOWAIT dentro de sql.begin()', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    const lockInBegin = beginCalls.some((q) => q.includes('FOR UPDATE NOWAIT'));
    expect(lockInBegin).toBe(true);
  });

  it('chama migrate() após adquirir o lock', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    expect(mockMigrate.mock.calls.length).toBe(1);
  });

  it('cria CREATE EXTENSION IF NOT EXISTS vector (D-08: comportamento intacto)', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    const vectorCall = sqlCalls.some((q) => q.includes('CREATE EXTENSION'));
    expect(vectorCall).toBe(true);
  });

  it('propaga erro de migrate() (lock liberado por rollback implícito)', async () => {
    const migrationError = new Error('intentional migration failure');
    mockMigrate.mockImplementationOnce(async () => {
      throw migrationError;
    });

    await expect(runMigrations(mockSql, '/tmp/migrations')).rejects.toThrow(
      'intentional migration failure',
    );
  });

  it('não usa pg_advisory_lock em nenhum momento', async () => {
    await runMigrations(mockSql, '/tmp/migrations');

    const usesAdvisory = sqlCalls.some((q) => q.includes('pg_advisory_lock'));
    expect(usesAdvisory).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PGB-05: prepare: false no bloco CLI (análise estática)
// ─────────────────────────────────────────────────────────────────────────────
describe('migrate.ts CLI block — PGB-05: prepare: false', () => {
  it('bloco import.meta.main usa postgres() com prepare: false', () => {
    const srcPath = join(import.meta.dir, 'migrate.ts');
    const src = readFileSync(srcPath, 'utf-8');
    // Match: postgres(connectionString, { ..., prepare: false, ... })
    const hasPrepare = /postgres\([^)]*prepare:\s*false/.test(src);
    expect(hasPrepare).toBe(true);
  });
});
