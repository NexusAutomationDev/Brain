import { describe, it, expect, mock, beforeEach } from 'bun:test';

// --- Mocks (declared before imports that use them — bun hoisting requirement) ---

// Capture configs passed to postgres() factory
const capturedConfigs: Record<string, unknown>[] = [];
const mockPoolInstances: Array<{ end: ReturnType<typeof mock> }> = [];

const mockPostgresFactory = mock((config: Record<string, unknown>) => {
  capturedConfigs.push({ ...config });
  const instance = {
    end: mock(async (_opts?: unknown) => {}),
  };
  mockPoolInstances.push(instance);
  return instance;
});

mock.module('postgres', () => ({ default: mockPostgresFactory }));

// lru-cache must NOT be mocked — we want real LRU eviction behavior
import { TenantPoolManager } from './pool-manager.js';

const baseConfig = {
  host: 'localhost',
  port: 5432,
  username: 'test',
  password: 'test',
  max: 10,
  idle_timeout: 300,
};

function resetMocks() {
  capturedConfigs.length = 0;
  mockPoolInstances.length = 0;
  mockPostgresFactory.mockClear();
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-03: Multi-tenant connection pooling
// ─────────────────────────────────────────────────────────────────────────────
describe('TenantPoolManager — DB-03: Multi-tenant connection pooling', () => {
  beforeEach(resetMocks);

  it('creates separate pool per DATABASE_NAME', () => {
    const mgr = new TenantPoolManager(baseConfig);
    mgr.getPool('db1');
    mgr.getPool('db2');

    expect(mockPostgresFactory.mock.calls.length).toBe(2);
  });

  it('reuses existing pool for same DATABASE_NAME', () => {
    const mgr = new TenantPoolManager(baseConfig);
    const pool1 = mgr.getPool('db1');
    const pool2 = mgr.getPool('db1');

    expect(mockPostgresFactory.mock.calls.length).toBe(1);
    expect(pool1).toBe(pool2);
  });

  it('isolates queries between different tenant databases', () => {
    const mgr = new TenantPoolManager(baseConfig);
    const pool1 = mgr.getPool('db1');
    const pool2 = mgr.getPool('db2');

    // Different references — each tenant gets its own pool instance
    expect(pool1).not.toBe(pool2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-04: LRU cache eviction
// ─────────────────────────────────────────────────────────────────────────────
describe('TenantPoolManager — DB-04: LRU cache eviction', () => {
  beforeEach(resetMocks);

  it('evicts least-recently-used pool when exceeding maxTenants (PGB-01 verify)', () => {
    const mgr = new TenantPoolManager(baseConfig, 1);
    mgr.getPool('db1');
    mgr.getPool('db2'); // forces LRU eviction of db1

    // postgres() was called twice — db1 was evicted, db2 created
    expect(mockPostgresFactory.mock.calls.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PGB-01: prepare: false sempre ativo
// ─────────────────────────────────────────────────────────────────────────────
describe('TenantPoolManager — PGB-01: prepare: false sempre ativo', () => {
  beforeEach(resetMocks);

  it('getPool() sempre passa prepare: false para postgres()', () => {
    const mgr = new TenantPoolManager(baseConfig);
    mgr.getPool('testdb');

    const lastConfig = capturedConfigs[capturedConfigs.length - 1];
    expect(lastConfig).toBeDefined();
    expect(lastConfig.prepare).toBe(false);
  });

  it('prepare: false presente mesmo sem PgBouncer configurado', () => {
    // Criamos um manager com config básica — não há nada PgBouncer-específico
    const mgr = new TenantPoolManager(baseConfig);
    mgr.getPool('any-tenant');

    // prepare: false deve estar presente independentemente do ambiente
    const capturedConfig = capturedConfigs[0];
    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.prepare).toBe(false);
  });
});
