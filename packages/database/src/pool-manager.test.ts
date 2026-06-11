import { describe, it, expect } from 'bun:test';

describe('TenantPoolManager (DB-03, DB-04)', () => {
  describe('DB-03: Multi-tenant connection pooling', () => {
    it.todo('creates separate pool per DATABASE_NAME');
    it.todo('reuses existing pool for same DATABASE_NAME');
    it.todo('isolates queries between different tenant databases');
  });

  describe('DB-04: LRU cache eviction', () => {
    it.todo('maintains up to 20 tenant pools in cache');
    it.todo('evicts least-recently-used pool when exceeding maxTenants');
    it.todo('calls dispose callback with pool cleanup on eviction');
    it.todo('recreates pool for evicted tenant on next access');
  });
});
