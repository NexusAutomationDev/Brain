import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock do módulo health.ts ANTES de importar server.ts
// Isso intercepta performHealthCheck sem depender da semântica de tagged template da Sql
let mockShouldSucceed = true;

mock.module('./health.js', () => ({
  checkDatabase: mock(async () => mockShouldSucceed),
  performHealthCheck: mock(async (_sql: unknown) => {
    if (mockShouldSucceed) {
      return {
        status: 'ok' as const,
        checks: { db: 'connected' as const },
        version: 'test',
        timestamp: new Date().toISOString(),
      };
    }
    return {
      status: 'error' as const,
      checks: { db: 'failed' as const },
      version: 'test',
      timestamp: new Date().toISOString(),
    };
  }),
}));

// Importar server APÓS configurar o mock
import { createHealthApp } from './server.js';
import type { Sql } from 'postgres';

// Sql mock mínimo — createHealthApp injeta mas performHealthCheck está mockado acima
const fakeSql = {} as unknown as Sql;

describe('GET /health (OBS-02)', () => {
  beforeEach(() => {
    mockShouldSucceed = true;
  });

  describe('when database is connected', () => {
    it('returns HTTP 200', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it('returns JSON with status "ok"', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('returns checks.db: "connected"', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      const body = await res.json();
      expect(body.checks.db).toBe('connected');
    });

    it('returns timestamp as ISO string', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      const body = await res.json();
      expect(typeof body.timestamp).toBe('string');
      expect(() => new Date(body.timestamp)).not.toThrow();
    });
  });

  describe('when database is unreachable', () => {
    beforeEach(() => {
      mockShouldSucceed = false;
    });

    it('returns HTTP 503', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      expect(res.status).toBe(503);
    });

    it('returns checks.db: "failed"', async () => {
      const app = createHealthApp(fakeSql);
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      const body = await res.json();
      expect(body.checks.db).toBe('failed');
    });
  });
});
