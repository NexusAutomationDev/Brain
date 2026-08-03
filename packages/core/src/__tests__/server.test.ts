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

// Minimal mock runner — only refreshPrompts()/injectMessage() are called by the endpoints
const mockRefreshPrompts = mock(async () => {});
const mockInjectMessage = mock(async () => {});
const mockRunner = {
  refreshPrompts: mockRefreshPrompts,
  injectMessage: mockInjectMessage,
} as any;

const ENDPOINT = 'http://localhost/reload-prompts';
const INJECT_ENDPOINT = 'http://localhost/debug/inject-message';

function makeRequest(headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, { method: 'POST', headers });
}

function makeInjectRequest(headers: Record<string, string> = {}, body: unknown = {}) {
  return new Request(INJECT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /reload-prompts (SDK-02, T-3-04-01, T-3-04-02)', () => {
  const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    mockRefreshPrompts.mockClear();
    mockInjectMessage.mockClear();
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

describe('POST /debug/inject-message (quick-260803-g4j, T-3-04-01, T-3-04-02)', () => {
  const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    mockRefreshPrompts.mockClear();
    mockInjectMessage.mockClear();
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
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'any-value' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(res.status).toBe(503);
    });

    it('does NOT call injectMessage when ADMIN_TOKEN is not set', async () => {
      delete process.env.ADMIN_TOKEN;
      const app = createCoreApp(mockRunner);
      await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'any-value' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });
  });

  describe('T-3-04-01: unauthorized access rejected with 401', () => {
    beforeEach(() => {
      process.env.ADMIN_TOKEN = 'secret-token';
    });

    it('returns 401 when X-Admin-Token header is missing', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({}, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 when X-Admin-Token header is wrong', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'wrong-token' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(res.status).toBe(401);
    });

    it('does NOT call injectMessage on unauthorized request', async () => {
      const app = createCoreApp(mockRunner);
      await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'wrong-token' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });
  });

  describe('quick-260803-g4j D-3: malformed body rejected with 400', () => {
    beforeEach(() => {
      process.env.ADMIN_TOKEN = 'secret-token';
    });

    it('returns 400 and does NOT call injectMessage when threadId is missing', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { content: 'olá' })
      );
      expect(res.status).toBe(400);
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });

    it('returns 400 and does NOT call injectMessage when content is missing', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { threadId: 'thread-abc' })
      );
      expect(res.status).toBe(400);
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });

    it('returns 400 when threadId is an empty string', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { threadId: '', content: 'olá' })
      );
      expect(res.status).toBe(400);
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });

    it('returns 400 when content is not a string', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { threadId: 'thread-abc', content: 123 })
      );
      expect(res.status).toBe(400);
      expect(mockInjectMessage).not.toHaveBeenCalled();
    });
  });

  describe('valid token and body: injectMessage is called and 200 returned', () => {
    beforeEach(() => {
      process.env.ADMIN_TOKEN = 'secret-token';
    });

    it('returns 200 with { status: "ok" }', async () => {
      const app = createCoreApp(mockRunner);
      const res = await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });

    it('calls runner.injectMessage("thread-abc", "olá") exactly once', async () => {
      const app = createCoreApp(mockRunner);
      await app.fetch(
        makeInjectRequest({ 'X-Admin-Token': 'secret-token' }, { threadId: 'thread-abc', content: 'olá' })
      );
      expect(mockInjectMessage).toHaveBeenCalledTimes(1);
      expect(mockInjectMessage).toHaveBeenCalledWith('thread-abc', 'olá');
    });
  });
});
