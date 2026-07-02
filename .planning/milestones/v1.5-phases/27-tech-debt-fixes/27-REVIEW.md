---
phase: 27-tech-debt-fixes
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/brain-sdr/src/brain.ts
  - apps/brain-sdr/src/index.ts
  - apps/brain-sdr/src/server.ts
  - packages/core/src/__tests__/integration/fup-e2e.test.ts
  - packages/core/src/__tests__/unit/registry/registry-env-whitelist.test.ts
  - packages/core/src/brain/interface.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/tools/registry.ts
  - packages/observability/src/__tests__/unit/health-transport.test.ts
  - packages/observability/src/health.ts
  - packages/observability/src/index.ts
  - packages/observability/src/server.ts
  - packages/transport/src/__tests__/unit/transport-status.test.ts
  - packages/transport/src/index.ts
  - packages/transport/src/interface.ts
  - packages/transport/src/rabbitmq/consumer.ts
  - packages/transport/src/webhook/handler.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 27: Code Review Report

**Reviewed:** 2026-06-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This phase covers tech-debt fixes across three packages (`core`, `observability`, `transport`) and `apps/brain-sdr`. The implementation is generally well-structured with good security practices (no hardcoded secrets, input validation, PII-safe logging). Two bugs stand out: a dead code path in the health server that causes `status='error'` to return HTTP 503 instead of 500, and a SIGTERM handler leak in `BrainRunner.init()` that accumulates listeners when called multiple times without an intervening `close()`. One additional correctness concern exists in the RabbitMQ consumer around retry map key collisions. Three informational items cover type safety and test design patterns.

## Warnings

### WR-01: `status='error'` always maps to HTTP 503, never 500 — dead code branch

**File:** `packages/observability/src/server.ts:30-35`
**Issue:** The HTTP status code mapping contains unreachable code. When `performHealthCheck()` returns `status='error'`, it always means `dbOk=false`, which always means `checks.db='failed'`. The condition `result.status === 'degraded' || result.checks.db === 'failed'` is therefore always `true` when `status='error'`, and the final `else` branch returning 500 is never reached. As a result, a DB connectivity failure incorrectly returns HTTP 503 instead of 500, and the comment "500: status === 'error'" is misleading to future maintainers. The test in `health-transport.test.ts` (Test 5) asserts `result.status === 'error'` but does not assert the HTTP status code — so this discrepancy is untested at the HTTP layer.

**Fix:**
```typescript
const httpStatus =
  result.status === 'ok'
    ? 200
    : result.status === 'error'
      ? 500
      : 503; // 'degraded' = transport disconnected
```

---

### WR-02: SIGTERM handler leak when `BrainRunner.init()` called multiple times

**File:** `packages/core/src/runner/runner.ts:194-199`
**Issue:** `init()` always registers a new SIGTERM handler via `process.on('SIGTERM', this._sigtermHandler)` at line 199, but does NOT remove the previous handler if `_sigtermHandler` was already set from a prior `init()` call. The `_sigtermHandler` field is overwritten at line 194, losing the reference to the old closure — meaning `process.off()` can never be called for it. In test environments (where `init()` may be called repeatedly on the same instance) or any reinitialisation scenario, this accumulates unremovable SIGTERM listeners. The comment at line 92 explicitly acknowledges "multiple init() calls (e.g. tests or reinitializations)" as a concern, but the guard in `close()` only fires when `close()` is explicitly called first.

**Fix:**
```typescript
// At the start of the SIGTERM registration block in init(), remove old handler first:
if (this._sigtermHandler) {
  process.off('SIGTERM', this._sigtermHandler);
  this._sigtermHandler = null;
}
this._sigtermHandler = async () => {
  this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
  await this.close();
  process.exit(0);
};
process.on('SIGTERM', this._sigtermHandler);
```

---

### WR-03: RabbitMQ retry map key collision risk between different message types

**File:** `packages/transport/src/rabbitmq/consumer.ts:111-113`
**Issue:** The retry map key is `${parsed.data.IDLead}:${parsed.data.Numero}` (line 111). If two distinct messages for the same lead arrive concurrently or in quick succession — for example, a legitimate retry after a transient error followed by a new independent message from the same lead — the second message inherits the retry count from the first. With `prefetch=1` this is less likely in practice, but it is theoretically possible after a `REQUEUE` cycle: a new message from the same lead arrives after the REQUEUE'd message is re-delivered, and the new message has its attempt count inflated, potentially being sent to DLQ prematurely after fewer than `MAX_ATTEMPTS` real failures. This is a correctness edge case, not a crash.

**Fix:** Include a content-based discriminator (e.g., a hash of `Message` content, or a timestamp) in the retry key, or document explicitly that `prefetch=1` is the architectural guarantee that makes this safe and add a code comment explaining why the key is correct. If documenting, the comment at line 33 should be expanded:
```typescript
// SAFE: prefetch=1 ensures only one message per IDLead:Numero is in-flight at a time.
// A new message with the same key cannot arrive until the current one is ACK'd or REQUEUE'd
// and consumed again — which resets the attempt counter at line 123.
const msgKey = `${parsed.data.IDLead}:${parsed.data.Numero}`;
```

---

## Info

### IN-01: `as any` used for LangChain `RunnableConfig` — proper type exists

**File:** `apps/brain-sdr/src/brain.ts:59`
**Issue:** `(config as any)?.configurable?.thread_id` bypasses TypeScript's type safety. LangChain exports `RunnableConfig` from `@langchain/core/runnables` which has a `configurable?: Record<string, unknown>` field. Using the proper type removes the suppressed `@typescript-eslint/no-explicit-any` at line 50 for `buildGraph(ctx)` return type and clarifies the access pattern.

**Fix:**
```typescript
import type { RunnableConfig } from "@langchain/core/runnables";

// In the boundQualifyTool closure:
async ({ description }, config: RunnableConfig) => {
  const sessionId = (config.configurable?.thread_id as string) ?? "";
```

---

### IN-02: Integration test has implicit ordering dependency between test cases

**File:** `packages/core/src/__tests__/integration/fup-e2e.test.ts:245-275`
**Issue:** Test 3 ("_tick() não processa lead com ia_ativada=false") relies on the DB state left by Test 2 (`ia_ativada=false` and `fup_enabled=false`). If Test 2 is skipped, fails, or the test runner changes execution order, Test 3's assertion that `fetchCallCount` does not increase becomes vacuous or misleading (the lead may still have `ia_ativada=true` from `beforeAll`). The comment "Lead está com ia_ativada=false após teste anterior" (line 249) documents the dependency but does not guard against it. `bun test` currently executes `describe` tests in declaration order, so this is low risk in practice.

**Fix:** Add an explicit precondition assertion at the start of Test 3:
```typescript
// Guard: confirm ia_ativada is false before proceeding
const [leadBefore] = await sql!`
  SELECT ia_ativada FROM leads WHERE unique_id = ${LEAD_UNIQUE_ID}
` as { ia_ativada: boolean }[];
expect(leadBefore.ia_ativada).toBe(false); // precondition from Test 2
```

---

### IN-03: `WebhookTransport.getStatus()` always returns `connected: true` after `stop()`

**File:** `packages/transport/src/webhook/handler.ts:158-160`
**Issue:** After `stop()` is called, `getStatus()` continues to return `{ type: 'webhook', connected: true }` even though the server is no longer accepting connections (`this.server` is `undefined`). This is intentional per the comment at line 155 and the test at `transport-status.test.ts:25-30`, but it means `/health` will report the webhook transport as `connected` even when the Brain's HTTP server has been shut down. This is only observable during graceful shutdown, so the operational risk is minimal. Consider returning `connected: this.server !== undefined` for a more accurate health signal, or document the invariant more prominently in `ITransport`.

**Fix (optional):**
```typescript
getStatus(): TransportStatus {
  return { type: 'webhook', connected: this.server !== undefined };
}
```

---

_Reviewed: 2026-06-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
