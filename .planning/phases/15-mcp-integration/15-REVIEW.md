---
phase: 15-mcp-integration
reviewed: 2026-06-16T04:40:41Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - apps/brain-echo/src/__tests__/unit/brain.test.ts
  - apps/brain-echo/src/brain.ts
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
  - apps/brain-sdr/src/brain.ts
  - packages/core/src/__tests__/integration/mcp-connection.test.ts
  - packages/core/src/__tests__/unit/mcp-init.test.ts
  - packages/core/src/__tests__/unit/mcp-tool-error.test.ts
  - packages/core/src/brain/interface.ts
  - packages/core/src/runner/runner.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-06-16T04:40:41Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This review covers the MCP integration introduced in phase 15: the updated `BrainBuildContext` interface, `BrainRunner._compileGraph()` MCP block, both Brain graph implementations (`brain-echo` and `brain-sdr`), and the accompanying test suite.

Overall, the design is solid. The `mcpTools: StructuredTool[]` contract on `BrainBuildContext`, the `onConnectionError: "ignore"` defensive startup pattern, `handleToolErrors: true` on `ToolNode`, and the `SIGTERM` → `close()` lifecycle chain are all implemented correctly. The unit tests cover the MCP init logic with good coverage of the filter, auth-token, and error-path branches.

Three issues of substance were found: one critical (mcpClient resource leak on `refreshPrompts()`), two warnings (SIGTERM handler accumulation and potential auth-token exposure via structured error logging), and three info items (hardcoded production URLs in unit tests, `console.log` in integration test, and a test that silently no-ops instead of skipping).

---

## Critical Issues

### CR-01: `mcpClient` resource leak on `refreshPrompts()` — old connection never closed

**File:** `packages/core/src/runner/runner.ts:148` and `packages/core/src/runner/runner.ts:317`

**Issue:** `refreshPrompts()` calls `_compileGraph()` which unconditionally assigns `this.mcpClient = new MultiServerMCPClient(...)` (line 317) without first closing the existing `this.mcpClient`. Every call to `/reload-prompts` when `MCP_URL` is set creates a new `MultiServerMCPClient` and abandons the previous one without calling `.close()`. The old client holds open HTTP/SSE connections and its internal resources are never released. In long-running Brain instances with prompt reloads, this leaks connections proportionally to the number of `/reload-prompts` calls.

**Fix:** Close the existing client at the top of `_compileGraph()` before creating a new one:

```typescript
private async _compileGraph(): Promise<void> {
  // Close any existing MCP client before recompiling (called by both init() and refreshPrompts())
  if (this.mcpClient) {
    await this.mcpClient.close();
    this.mcpClient = null;
  }

  // ... rest of _compileGraph() unchanged
  const dbUrl = process.env.DATABASE_URL;
  // ...
}
```

---

## Warnings

### WR-01: SIGTERM handler accumulates on every `init()` call

**File:** `packages/core/src/runner/runner.ts:125`

**Issue:** `process.on('SIGTERM', ...)` is called inside `init()` (line 125). If `init()` is ever called more than once on the same `BrainRunner` instance — which is not explicitly guarded against — each call registers an additional SIGTERM handler. Node.js/Bun emits a `MaxListenersExceededWarning` after 10 listeners, but more practically each handler will call `this.close()` sequentially when SIGTERM fires, leading to a double-close on `mcpClient` (the second call is a no-op due to the null guard, but the `process.exit(0)` runs multiple times — the second invocations are no-ops but add confusion in logs). Additionally, `process.on` never de-registers, so each `BrainRunner` instance that gets garbage-collected still keeps the handler alive.

**Fix:** Guard against duplicate registration with a boolean flag, or use `process.once`:

```typescript
// Option A: use once() — handler auto-removes after first fire
process.once('SIGTERM', async () => {
  this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
  await this.close();
  process.exit(0);
});

// Option B: guard with a flag
private sigTermRegistered = false;

// inside init(), after _compileGraph():
if (!this.sigTermRegistered) {
  this.sigTermRegistered = true;
  process.on('SIGTERM', async () => {
    this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
    await this.close();
    process.exit(0);
  });
}
```

Option A (`process.once`) is simpler and fits the intent: SIGTERM is received at most once per process lifetime.

### WR-02: MCP error catch block logs the raw `err` object — may expose `Authorization` header

**File:** `packages/core/src/runner/runner.ts:351-353`

**Issue:** When the MCP connection or `getTools()` call fails, the catch block logs `{ brainId, err }` (line 352). The comment correctly notes not to log `process.env.MCP_AUTH_TOKEN` directly. However, depending on the HTTP client used by `@langchain/mcp-adapters`, the thrown `err` object may include the outgoing request object, which carries the `Authorization: Bearer <token>` header in its properties. Pino serialises the full error tree by default. The token is therefore potentially logged indirectly through the error object.

**Fix:** Log only the error message, not the entire error object:

```typescript
} catch (err) {
  // SECURITY: log only message — err object may contain Authorization header (T-15-01)
  const errMessage = err instanceof Error ? err.message : String(err);
  this.logger.warn(
    { brainId: this.brain.id, errMessage },
    "MCP server unreachable at startup — continuing with native tools only (MCP-03)"
  );
  this.mcpClient = null;
  mcpTools = [];
}
```

### WR-03: Unit test silently passes when node handler cannot be extracted — assertion is skipped

**File:** `apps/brain-echo/src/__tests__/unit/brain.test.ts:143-158`

**Issue:** The test "nó do grafo invoca LLM com slice das mensagens quando CONTEXT_WINDOW_MESSAGES=2" (line 103) accesses `graph.nodes?.["llm"]?.action ?? graph._nodes?.["llm"]?.runnable?.func` (line 143). When neither private path resolves (which will happen if `@langchain/langgraph` changes its internal structure), the test falls into the `else` branch at line 152, which only tests the `slice()` built-in — not the actual graph node behaviour. The test produces a green result while the real assertion about `capturedMessages` being populated (line 148) is never executed and never verified. This masks regressions in context-window slicing inside the node.

**Fix:** Explicitly skip the test (or mark it as pending) when the node handler cannot be found, rather than silently falling back to a weaker assertion:

```typescript
const nodeHandler = graph.nodes?.["llm"]?.action ?? graph._nodes?.["llm"]?.runnable?.func;
if (!nodeHandler) {
  // Internal StateGraph structure unavailable — cannot test node directly.
  // This test must be updated for the installed version of @langchain/langgraph.
  console.warn("SKIP: nodeHandler not found — check StateGraph internals for installed version");
  return; // explicit skip, not a silent pass with a weaker assertion
}
await nodeHandler(fakeState);
const historyMsgs = capturedMessages.slice(1);
expect(historyMsgs.length).toBeLessThanOrEqual(2);
expect(historyMsgs[historyMsgs.length - 1]).toMatchObject({ content: "msg5" });
```

---

## Info

### IN-01: Production URL hardcoded in unit test file

**File:** `packages/core/src/__tests__/unit/mcp-init.test.ts:99` (and lines 112, 123, 134, 144, 156, 166)

**Issue:** The URL `https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05` is hardcoded in all 7 test cases. These are unit tests (no network calls made — the helper uses a `fakeClient` mock). The URL is never actually contacted, but it is still a hardcoded reference to what appears to be a real production or staging endpoint embedded in committed test code. Beyond the informational concern, if the UUID in the URL is an access key or session token, it is now committed to version history.

**Fix:** Extract to a named constant at the top of the file so it is visually obvious and easy to change:

```typescript
const TEST_MCP_URL = "https://example.com/mcp/test-server-id";
// or, if the real URL is needed for documentation:
const TEST_MCP_URL = "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05";
```

Replace all 7 occurrences with `TEST_MCP_URL`. In unit tests the value does not matter (it is mocked), so a generic sentinel like `"https://mcp.example.com/server"` is preferred.

### IN-02: `console.log` / `console.warn` in integration test — use structured logger

**File:** `packages/core/src/__tests__/integration/mcp-connection.test.ts:38,44,59`

**Issue:** The integration test uses `console.warn` and `console.log` directly. The project uses `pino` via `createLogger()` for structured logging. While test files are lower-priority for this convention, `console.log` output appears inline with test runner output and is harder to silence or filter in CI. More importantly, line 38 logs the raw `err` object from a network failure, which may include sensitive request details.

**Fix:** Either suppress non-critical log output in tests (acceptable for integration tests) or replace with structured logging. At minimum, avoid logging the raw error object on network failure:

```typescript
// line 38 — log only the message, not the full error
console.warn("Servidor MCP inacessível — pulando teste de integração:", err instanceof Error ? err.message : String(err));
```

### IN-03: Default fallback URL in integration test bypasses the env-variable intent

**File:** `packages/core/src/__tests__/integration/mcp-connection.test.ts:12-15`

**Issue:** The integration test falls back to the hardcoded production URL when `MCP_TEST_URL` is not set (line 13-15):

```typescript
const MCP_TEST_URL =
  process.env.MCP_TEST_URL ??
  "https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05";
```

This means running `bun test` in a clean environment (no `MCP_TEST_URL` set) will attempt a real network call to the production/staging server. The test then recovers gracefully via `try/catch`, but the intent of an integration test with an env-variable guard is that it should be skipped when the env variable is absent — not that it should silently try production and skip on connection failure. CI pipelines without `MCP_TEST_URL` set will make external network requests that may be blocked, slow, or inadvertently hit production.

**Fix:** Skip the entire test suite when `MCP_TEST_URL` is not set:

```typescript
const MCP_TEST_URL = process.env.MCP_TEST_URL;

describe("MCP Integration — servidor real", () => {
  if (!MCP_TEST_URL) {
    test.skip("MCP_TEST_URL not set — skipping integration tests", () => {});
    return;
  }
  // ... rest of the suite, using MCP_TEST_URL (non-null here)
});
```

---

_Reviewed: 2026-06-16T04:40:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
