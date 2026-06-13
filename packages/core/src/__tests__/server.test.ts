// SDK-02 / T-3-04-01 / T-3-04-02: POST /reload-prompts endpoint
// Tests for createCoreApp() — authentication and security behaviors.
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock @brain-pkg/observability BEFORE importing server.ts
// Pattern: same as brain-runner.test.ts and observability/server.test.ts
mock.module('@brain-pkg/observability', () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  })),
}));

// Import after mock is registered
import { createCoreApp } from '../server.js';

// Minimal mock runner — only refreshPrompts() is called by the endpoint
const mockRefreshPrompts = mock(async () => {});
const mockRunner = {
  refreshPrompts: mockRefreshPrompts,
} as any;

const ENDPOINT = 'http://localhost/reload-prompts';

function makeRequest(headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, { method: 'POST', headers });
}

describe('POST /reload-prompts (SDK-02, T-3-04-01, T-3-04-02)', () => {
  const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    mockRefreshPrompts.mockClear();
  });

  afterEach(() => {
    // Restore env state after each test
    if (ORIGINAL_ADMIN_TOKEN === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
    }
  });

  describe('T-3-04-02: fail closed when ADMIN_TOKEN env var is not configured', () => {
    it('returns 503 when ADMIN_TOKEN is not set', async () => {
      delete process.env.ADMIN_TOKEN;
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest({ 'X-Admin-Token': 'any-value' }));
      expect(res.status).toBe(503);
    });

    it('does NOT call refreshPrompts when ADMIN_TOKEN is not set', async () => {
      delete process.env.ADMIN_TOKEN;
      const app = createCoreApp(mockRunner);
      await app.fetch(makeRequest({ 'X-Admin-Token': 'any-value' }));
      expect(mockRefreshPrompts).not.toHaveBeenCalled();
    });
  });

  describe('T-3-04-01: unauthorized access rejected with 401', () => {
    beforeEach(() => {
      process.env.ADMIN_TOKEN = 'secret-token';
    });

    it('returns 401 when X-Admin-Token header is missing', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest()); // no header
      expect(res.status).toBe(401);
    });

    it('returns 401 when X-Admin-Token header is wrong', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest({ 'X-Admin-Token': 'wrong-token' }));
      expect(res.status).toBe(401);
    });

    it('returns body with { error: "Unauthorized" } on 401', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest({ 'X-Admin-Token': 'wrong-token' }));
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('does NOT call refreshPrompts on unauthorized request', async () => {
      const app = createCoreApp(mockRunner);
      await app.fetch(makeRequest({ 'X-Admin-Token': 'wrong-token' }));
      expect(mockRefreshPrompts).not.toHaveBeenCalled();
    });
  });

  describe('valid token: refreshPrompts is called and 200 returned', () => {
    beforeEach(() => {
      process.env.ADMIN_TOKEN = 'secret-token';
    });

    it('returns 200 when X-Admin-Token matches ADMIN_TOKEN', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest({ 'X-Admin-Token': 'secret-token' }));
      expect(res.status).toBe(200);
    });

    it('returns body with { status: "ok" } on success', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(makeRequest({ 'X-Admin-Token': 'secret-token' }));
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('calls runner.refreshPrompts() when token is valid', async () => {
      const app = createCoreApp(mockRunner);
      await app.fetch(makeRequest({ 'X-Admin-Token': 'secret-token' }));
      expect(mockRefreshPrompts).toHaveBeenCalledTimes(1);
    });
  });
});
