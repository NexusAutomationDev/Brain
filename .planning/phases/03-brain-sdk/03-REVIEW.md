---
phase: 03-brain-sdk
reviewed: 2026-06-12T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - .env.example
  - packages/core/package.json
  - packages/core/src/brain/__tests__/brain-registry.test.ts
  - packages/core/src/brain/interface.ts
  - packages/core/src/brain/registry.ts
  - packages/core/src/index.ts
  - packages/core/src/prompts/__tests__/loader.test.ts
  - packages/core/src/prompts/loader.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/server.ts
  - packages/core/src/tools/__tests__/tools-registry.test.ts
  - packages/core/src/tools/registry.ts
  - packages/core/tsconfig.json
  - packages/database/src/migrations/0001_lazy_deathstrike.sql
  - packages/database/src/migrations/meta/0001_snapshot.json
  - packages/database/src/migrations/meta/_journal.json
  - packages/database/src/schema/tables.ts
  - packages/transport/src/webhook/handler.ts
  - pnpm-lock.yaml
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 03: Brain SDK — Code Review Report

**Reviewed:** 2026-06-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

The Brain SDK core is well-structured and the layered design (IBrain → BrainRunner → BrainRegistry → ToolsRegistry → loadPrompts) is clean and coherent. Security intent is evident throughout (fail-closed ADMIN_TOKEN, double-filter on prompts query, no state leakage in run()). Tests cover the main paths effectively.

Two critical issues were identified: a timing-attack vulnerability in the admin token comparison and an uncaught-exception exposure in the webhook handler when `runner.run()` throws. Four warnings cover a NaN gap in embedding dimension parsing, a concurrent-refresh race condition during hot reload, the `createCoreApp` function being unreachable from the public API barrel, and the `WebhookTransport.start()` not accepting a runner, which silently disables brain dispatch in production. Three info items note the hardcoded default ADMIN_TOKEN, a `process.env.DATABASE_URL!` non-null assertion without a startup check, and a dynamic import inside `_compileGraph`.

---

## Critical Issues

### CR-01: Timing-attack vulnerability in admin token comparison

**File:** `packages/core/src/server.ts:37`
**Issue:** The admin token is compared with string equality (`token !== adminToken`). This is a timing-side-channel: a brute-force attacker can distinguish correct prefix bytes by measuring response latency. Even for a 32-character opaque token this is exploitable with sufficient measurement resolution, particularly since the endpoint is likely accessible from localhost without TLS jitter.

The comment on line 36 acknowledges info-disclosure concerns around *which* error to return but misses the timing channel in the comparison itself.

**Fix:** Use Node's `crypto.timingSafeEqual` (available in Bun's Node compat layer):
```typescript
import { timingSafeEqual } from "node:crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// In the handler:
if (!token || !safeCompare(token, adminToken)) {
  logger.warn({}, "/reload-prompts unauthorized attempt");
  return c.json({ error: "Unauthorized" }, 401);
}
```

---

### CR-02: Unhandled exception from `runner.run()` crashes the webhook handler

**File:** `packages/transport/src/webhook/handler.ts:62`
**Issue:** `await runner.run(event)` is called without a try/catch. If `run()` throws (e.g., LangGraph graph error, DB connection failure, `ConfigurationError` when `init()` was skipped), the exception propagates unhandled through Hono. Depending on the Hono version and the Bun server configuration, this either crashes the process or returns a generic 500 with a stack trace in the body, which leaks internal implementation details to callers.

The `BrainRunner.run()` itself does not have any try/catch wrapper either (see `runner.ts:120-168`), so errors from `this.compiledGraph.invoke(...)`, `this.memoryManager.getContext(...)`, or `this.memoryManager.saveContext(...)` all propagate uncaught.

**Fix:** Wrap the runner dispatch in a try/catch and return a sanitized 500:
```typescript
try {
  const result = await runner.run(event);
  return c.json({ status: "ok", reply: result.reply });
} catch (err) {
  // Log internally but never expose stack trace or internal error detail
  logger.error({ err }, "BrainRunner.run() failed");
  return c.json({ error: "Internal server error" }, 500);
}
```

---

## Warnings

### WR-01: `parseInt` result not checked for `NaN` before range validation

**File:** `packages/database/src/schema/tables.ts:5-11`
**Issue:** `parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)` returns `NaN` when the env var contains a non-numeric string (e.g., `EMBEDDING_DIMENSIONS=abc`). The subsequent range check `EMBEDDING_DIM < 128 || EMBEDDING_DIM > 4096` evaluates to `false` for `NaN` (all comparisons with NaN are false), so the validation silently passes, and `NaN` is passed to `vector('embedding', { dimensions: NaN })`. This causes a schema definition error at migration time instead of the clear startup validation message that was intended.

**Fix:**
```typescript
const raw = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);
if (isNaN(raw) || raw < 128 || raw > 4096) {
  throw new Error(
    `Invalid EMBEDDING_DIMENSIONS: "${process.env.EMBEDDING_DIMENSIONS}". Must be an integer between 128 and 4096.`
  );
}
const EMBEDDING_DIM = raw;
```

---

### WR-02: `refreshPrompts()` has a race condition window under concurrent requests

**File:** `packages/core/src/runner/runner.ts:106-111`
**Issue:** `refreshPrompts()` calls `loadPrompts` then `_compileGraph()`. During `_compileGraph()` (which is async and takes non-trivial time: checkpointer setup + graph compilation), `run()` calls on concurrent requests continue using `this.compiledGraph` which is the *old* compiled graph but `this.prompts` has already been updated to the new values. After `_compileGraph()` completes, `this.compiledGraph` is atomically replaced with the newly compiled graph.

The more dangerous sub-case: if `_compileGraph()` throws partway through (e.g., `createCheckpointer()` fails), `this.prompts` has already been updated to the new values but `this.compiledGraph` still points to the graph compiled with the *old* prompts snapshot — a silently inconsistent state.

**Fix:** Keep a local `newPrompts` variable and only commit both changes together after `_compileGraph` succeeds:
```typescript
async refreshPrompts(): Promise<void> {
  this.logger.info({ brainId: this.brain.id }, "Refreshing prompts");
  const newPrompts = await loadPrompts(this.sql, this.brain.brainType, this.brain.promptKeys);
  // _compileGraph will use this.prompts — stage new prompts only if compile succeeds
  const previousPrompts = this.prompts;
  this.prompts = newPrompts;
  try {
    await this._compileGraph();
  } catch (err) {
    this.prompts = previousPrompts; // rollback on failure
    throw err;
  }
  this.logger.info({ brainId: this.brain.id }, "Prompts refreshed and graph recompiled");
}
```

---

### WR-03: `createCoreApp` is not exported from the package barrel

**File:** `packages/core/src/index.ts:1-16` / `packages/core/src/server.ts:21`
**Issue:** `createCoreApp()` is the public function Brain implementors call to mount the `/reload-prompts` endpoint. It is exported from `server.ts` but is **not re-exported** from `packages/core/src/index.ts`. Any consumer importing from `@brain-pkg/core` cannot access it without reaching into the internal module path (`@brain-pkg/core/src/server`), which bypasses the controlled public surface and breaks when the package is compiled to `dist/`.

**Fix:** Add to `packages/core/src/index.ts`:
```typescript
// SDK-02: Core HTTP management server
export { createCoreApp } from "./server.js";
```

---

### WR-04: `WebhookTransport.start()` never wires a runner — brain dispatch silently disabled

**File:** `packages/transport/src/webhook/handler.ts:80-85`
**Issue:** `WebhookTransport.start()` calls `createWebhookApp()` with no arguments. The `runner` parameter of `createWebhookApp` is optional, and when absent the handler returns `{ status: "accepted" }` for all events without calling any Brain. The comment says "should not occur in production" but the `WebhookTransport` class itself is the production path and it never provides a runner. Any Brain deployed using `new WebhookTransport()` will silently accept events and return `"accepted"` without processing them.

**Fix:** `WebhookTransport.start()` should accept and forward a runner:
```typescript
export class WebhookTransport implements ITransport {
  private server: ReturnType<typeof Bun.serve> | undefined;

  async start(port = 3000, runner?: IBrainRunnerLike): Promise<void> {
    const app = createWebhookApp(runner);
    this.server = Bun.serve({ port, fetch: app.fetch });
  }
  // ...
}
```
Or alternatively, the runner should be passed to the constructor and stored, then forwarded at `start()` time.

---

## Info

### IN-01: Default `ADMIN_TOKEN` value in `.env.example` is a hardcoded weak placeholder

**File:** `.env.example:22`
**Issue:** `ADMIN_TOKEN=change-me-in-production` is a known default that appears in version control. While `.env.example` is intentionally not a real secret, if a developer copies it directly to `.env` without changing this value, any party aware of the codebase can call `POST /reload-prompts` with `X-Admin-Token: change-me-in-production`. The server.ts does not validate minimum token entropy (it would accept any non-empty string).

**Fix:** Replace the placeholder with a comment instructing token generation:
```
# Generate with: openssl rand -hex 32
ADMIN_TOKEN=
```
This forces the developer to actively generate a value rather than accepting the default.

---

### IN-02: `process.env.DATABASE_URL!` non-null assertion has no startup validation

**File:** `packages/core/src/runner/runner.ts:177`
**Issue:** The `!` non-null assertion suppresses TypeScript's check but does not prevent a runtime `undefined` from being passed to `createCheckpointer()`. If `DATABASE_URL` is absent, the behavior depends on `createCheckpointer`'s internal handling — it may throw a cryptic error or silently connect to `undefined`. The `init()` lifecycle that calls `_compileGraph()` runs after prompts are loaded; a missing `DATABASE_URL` is not caught until that point, producing a confusing failure message.

**Fix:** Add an explicit early check in `init()` or `_compileGraph()`:
```typescript
private async _compileGraph(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigurationError("DATABASE_URL environment variable is required", {});
  }
  const checkpointer = await createCheckpointer(databaseUrl);
  // ...
}
```

---

### IN-03: Dynamic `import()` of `drizzle-orm/postgres-js` inside `_compileGraph` called on every refresh

**File:** `packages/core/src/runner/runner.ts:181`
**Issue:** `_compileGraph()` uses `const { drizzle } = await import("drizzle-orm/postgres-js")` on every call. This is called during `init()` and again on every `refreshPrompts()`. While Bun caches modules after first load (so this is not a correctness issue), the pattern is unusual — `drizzle` is a static dependency that should be a top-level static import. The dynamic import makes the dependency relationship less visible and slows down the first `_compileGraph()` call by adding module resolution overhead.

**Fix:** Move to a static import at the top of the file alongside the other imports:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
```
This is consistent with how `loadPrompts` handles `drizzle-orm/postgres-js` (via static import in `loader.ts`).
