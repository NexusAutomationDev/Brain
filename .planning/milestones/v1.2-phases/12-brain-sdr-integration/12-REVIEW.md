---
phase: 12-brain-sdr-integration
reviewed: 2026-06-15T19:47:29Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - apps/brain-sdr/package.json
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
  - apps/brain-sdr/src/brain.ts
  - apps/brain-sdr/src/index.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/transport/src/webhook/handler.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-15T19:47:29Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This phase integrates the Brain SDR app with the webhook transport, introduces standard tools (pause_session, finish_conversation), and wires up the BrainRunner lifecycle in `index.ts`. The overall architecture is well-structured: the IBrain contract is properly fulfilled, the tool-binding closure pattern (D-04) is sound, the fail-fast ENV validation is correct, and the webhook handler security (token auth, zod validation, fail-closed 503) is solid.

Three issues stand out:

1. **Critical:** `PostgresSaver.fromConnString()` creates a new database connection on every `qualify_lead` invocation and that connection is never closed — a connection leak that will exhaust the Postgres connection pool under production load.
2. **Warning:** `main()` in `index.ts` is called without `.catch()`, so startup failures after the synchronous ENV checks (e.g., `runner.init()` throwing) result in an unhandled promise rejection with no structured log and a non-zero exit that Docker may silently restart.
3. **Warning:** Bearer token comparison in `handler.ts` uses `===` (string equality), which is subject to timing attacks. The impact is low for short-lived webhook tokens but violates the stated security posture (T-vcu-01).

The remaining issues are minor quality findings.

---

## Critical Issues

### CR-01: PostgresSaver connection leaked on every qualify_lead call

**File:** `apps/brain-sdr/src/qualifier.ts:196`

**Issue:** `PostgresSaver.fromConnString(dbUrl)` allocates a new internal Postgres connection pool on every call to `runQualificationAgent()`. The `saver` object is never closed after `getTuple()` returns. Under moderate traffic — one qualify_lead invocation per active conversation — this leaks a connection per call and will eventually exhaust `max_connections` on the Postgres server, causing ALL Brain operations (including the main graph) to fail.

The `saveQualificationToMemories` helper at lines 28-40 correctly opens a `postgres` connection with `max: 1` and closes it in `finally`. The `saver` block does not apply the same pattern.

**Fix:**

```typescript
// qualifier.ts — runQualificationAgent(), inside try block
const saver = PostgresSaver.fromConnString(dbUrl);
try {
  const tuple = await saver.getTuple({
    configurable: { thread_id: sessionId },
  });
  // ... rest of logic unchanged ...
  return finalResult;
} finally {
  // Release the internal postgres.js connection created by fromConnString
  await (saver as any).db?.end?.();
}
```

If `PostgresSaver` exposes a typed `close()` or `end()` method in the version pinned (`^1.0.1`), prefer that. Alternatively, refactor `runQualificationAgent` to accept the already-open `sql` instance (passed via `ctx.sql` from `brain.ts`) and use `PostgresSaver.fromPool(sql)` — this avoids creating a second connection altogether and aligns with the existing pool management strategy in `index.ts`.

---

## Warnings

### WR-01: main() called without .catch() — unhandled rejection on startup failure

**File:** `apps/brain-sdr/src/index.ts:93`

**Issue:** `main()` is an `async` function called at the module level without `.catch()`. Errors thrown after the synchronous ENV-checks (e.g., `runner.init()` throwing a migration failure or DB connection error) will surface as an unhandled promise rejection. In Node/Bun, unhandled rejections produce a warning log but do NOT call `process.exit(1)` by default unless `--unhandled-rejections=throw` is set. Docker will not see a non-zero exit code, the container may be considered healthy, and the Brain will silently accept connections while in a broken state.

**Fix:**

```typescript
// index.ts — last line
main().catch((err) => {
  logger.error({ err }, "Fatal startup error — exiting");
  process.exit(1);
});
```

### WR-02: Bearer token compared with === — timing oracle

**File:** `packages/transport/src/webhook/handler.ts:52`

**Issue:** `bearer !== webhookToken` uses JavaScript string equality, which may short-circuit on the first differing byte. A remote attacker with many requests can statistically distinguish correct token prefixes from incorrect ones (timing side-channel). For a webhook shared secret, this is low-severity in practice but contradicts the documented security posture (T-vcu-01, ASVS V5) and is trivial to fix.

**Fix:**

```typescript
import { timingSafeEqual } from "node:crypto";

// Replace line 52:
const tokenMatch =
  bearer.length === webhookToken.length &&
  timingSafeEqual(Buffer.from(bearer), Buffer.from(webhookToken));
if (!tokenMatch) {
  logger.warn({}, "/api/v1/webhook unauthorized attempt");
  return c.json({ error: "Unauthorized" }, 401);
}
```

### WR-03: handler.test.ts lacks coverage for 401 and 503 auth paths

**File:** `packages/transport/src/webhook/handler.test.ts` (entire file)

**Issue:** All 8 tests set `WEBHOOK_TOKEN` in `beforeEach` and send a valid `Authorization: Bearer` header. No test verifies:
- **401**: wrong token / missing Authorization header
- **503**: WEBHOOK_TOKEN not set (fail-closed path at `handler.ts:45-47`)

Both paths contain production-critical security logic. The 503 fail-closed path in particular is the main guard against the service accepting requests in an unconfigured state. Without a test, a future refactor could silently break it.

**Fix:** Add two test cases to the existing `describe` block:

```typescript
it("POST /api/v1/webhook with wrong token returns 401", async () => {
  const req = new Request("http://localhost/api/v1/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer wrong-token",
    },
    body: JSON.stringify(validEvent),
  });
  const res = await app.fetch(req);
  expect(res.status).toBe(401);
  const body = await res.json() as Record<string, unknown>;
  expect(body.error).toBe("Unauthorized");
});

it("POST /api/v1/webhook sem WEBHOOK_TOKEN retorna 503 (fail-closed)", async () => {
  delete process.env.WEBHOOK_TOKEN; // override beforeEach setup
  const req = new Request("http://localhost/api/v1/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TEST_TOKEN}`,
    },
    body: JSON.stringify(validEvent),
  });
  const res = await app.fetch(req);
  expect(res.status).toBe(503);
});
```

---

## Info

### IN-01: createLLM() instantiated inside graph node — new LLM client per qualify_lead call

**File:** `apps/brain-sdr/src/qualifier.ts:115`

**Issue:** `createLLM()` is called inside the `analyze` node function, which runs on every `qualify_lead` invocation. Depending on what `createLLM()` does internally (HTTP client creation, SDK initialization), this may create unnecessary object allocation per call. The main brain graph correctly receives the LLM via `ctx.llm` (injected once at `buildGraph` time).

This is not a correctness bug — the sub-agent is stateless by design — but it is inconsistent with the rest of the stack.

**Fix:** Consider moving `createLLM()` to module level alongside `compiledQualificationGraph`, or accept it as a parameter to `runQualificationAgent` so it can be shared with the main graph's LLM instance.

### IN-02: Commented-out code references in brain.ts

**File:** `apps/brain-sdr/src/brain.ts:29`

**Issue:** Line 29 contains `// eslint-disable-next-line @typescript-eslint/no-explicit-any` above `buildGraph(ctx: BrainBuildContext): any`. The `any` return type on `buildGraph` suppresses type checking for the graph returned to `BrainRunner`. If the `IBrain` interface defines `buildGraph` as returning `any`, this is unavoidable — but it is worth tracking as a typing gap.

**Fix:** If `@brain-pkg/core` can export a `BrainGraph` type (or if `StateGraph` is re-exported from `@brain-pkg/ai`), replace `any` with the concrete type to catch contract mismatches at compile time.

---

_Reviewed: 2026-06-15T19:47:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
