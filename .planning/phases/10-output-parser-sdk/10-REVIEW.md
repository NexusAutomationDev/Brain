---
phase: 10-output-parser-sdk
reviewed: 2026-06-15T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - apps/brain-echo/src/brain.ts
  - packages/ai/src/graph/state.ts
  - packages/core/package.json
  - packages/core/src/__tests__/unit/output/schema.test.ts
  - packages/core/src/index.ts
  - packages/core/src/output/schema.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/runner.ts
  - packages/shared/src/errors/index.ts
  - packages/shared/src/types/index.ts
  - packages/transport/src/__tests__/unit/webhook-auth.test.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/transport/src/webhook/handler.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This phase introduces the Output Parser SDK: the `BrainOutput` structured output contract (`packages/shared`), the `BrainOutputSchema` Zod validator (`packages/core/src/output/schema.ts`), integration into `BrainRunner.run()`, and downstream surfacing via the webhook handler. The architecture is sound — the dependency direction (shared → ai → core → transport) is respected, the fail-closed security posture is correct, and the Zod superRefine conditional validation is well-structured.

One critical bug was found: `BrainRunner.run()` references `event.Name` (line 160) but the `BrainEvent` type uses `Name` (capital N) while the field being read is `event.Name` — this is actually correct field access. However a distinct critical issue exists: `memoryManager` is checked as falsy in the guard at line 150, but `memoryManager` is only assigned inside `_compileGraph()` which is called from `init()`. If `_compileGraph()` fails partway through (e.g., `createCheckpointer` throws before `this.memoryManager` is assigned), `init()` can return without a `process.exit(1)` and `memoryManager` remains `null`, allowing a subsequent `run()` to throw `ConfigurationError` instead of the fail-fast pattern being consistent.

Four warnings cover meaningful logic risks: duplicate `contextWindowSize` computation, a timing gap in `BrainRunner` error handling, a missing test assertion on the error type in D-14 tests, and a token comparison without constant-time equality. Three info items cover code duplication and minor quality concerns.

## Critical Issues

### CR-01: Token comparison uses direct string equality — timing side-channel

**File:** `packages/transport/src/webhook/handler.ts:53`
**Issue:** The Bearer token is compared with `bearer !== webhookToken` — a standard string equality check in JavaScript. While Node.js/Bun string comparison is not guaranteed to be constant-time, for short fixed-length tokens this can leak timing information to a network-capable attacker who can measure many requests. OWASP ASVS V2.9.1 requires constant-time comparison for secrets. The token is a shared secret used for authentication, making this a security concern.
**Fix:**
```typescript
import { timingSafeEqual } from "node:crypto";

// Replace line 53:
if (!bearer || !timingSafeEqual(Buffer.from(bearer), Buffer.from(webhookToken))) {
```
Note: `timingSafeEqual` requires both buffers to have equal length; if lengths differ it throws. Wrap:
```typescript
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
if (!bearer || !safeTokenCompare(bearer, webhookToken)) {
```

---

## Warnings

### WR-01: `contextWindowSize` computed twice — duplicated logic with divergence risk

**File:** `packages/core/src/runner/runner.ts:179-182` and `apps/brain-echo/src/brain.ts:28-31`
**Issue:** The ENV parsing logic for `CONTEXT_WINDOW_MESSAGES` is duplicated verbatim in both `BrainRunner.run()` and the `llm` node inside `brain-echo`. If the default value or clamping logic changes in one place, the other silently diverges. The runner computes `contextWindowSize` but only uses it for logging (the actual slice is done in the graph node), which means the runner-side computation is purely informational — but the duplication means there are two independent sources of truth for the same configuration value.
**Fix:** Extract to a shared utility in `packages/shared` or `packages/core`:
```typescript
// packages/shared/src/config.ts
export function getContextWindowSize(): number {
  const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
  return n > 0 && isFinite(n) ? n : 40;
}
```
Then import and call `getContextWindowSize()` in both locations.

### WR-02: `_compileGraph()` failure leaves runner in partially-initialized state without exiting

**File:** `packages/core/src/runner/runner.ts:261-297`
**Issue:** `_compileGraph()` calls `createCheckpointer(dbUrl)` and `new MemoryManager(...)` without wrapping these in a try/catch. If `createCheckpointer` throws (e.g., bad `DATABASE_URL` format, network error), the error propagates out of `_compileGraph()` and then out of `init()` to the caller — but `process.exit(1)` is NOT called. This breaks the fail-fast pattern established elsewhere in `init()`. The caller (e.g., `apps/brain-*/src/index.ts`) might catch the error and continue, leading to a partially-initialized Brain that accepts requests (which then fail with `ConfigurationError` at runtime).

Contrast with the existing pattern for `runMigrations` at line 98:
```typescript
await runMigrations(...).catch((err) => {
  this.logger.error(...);
  process.exit(1);
});
```
**Fix:** Apply the same pattern to `_compileGraph()`:
```typescript
private async _compileGraph(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    this.logger.error({ brainId: this.brain.id }, "DATABASE_URL is not set");
    process.exit(1);
  }
  let checkpointer: Awaited<ReturnType<typeof createCheckpointer>>;
  try {
    checkpointer = await createCheckpointer(dbUrl);
  } catch (err) {
    this.logger.error({ brainId: this.brain.id, err }, "createCheckpointer failed — aborting init");
    process.exit(1);
  }
  // ... rest of method
}
```

### WR-03: D-14 tests assert `.rejects.toThrow()` without checking error type — weak assertions

**File:** `packages/core/src/runner/__tests__/brain-runner.test.ts:355` and `374`
**Issue:** Both D-14 tests assert that `runner.run(makeEvent())` rejects with `toThrow()` — no argument. This means any error (including an unexpected `TypeError` or `ConfigurationError`) would make the test pass. The documented behavior (and the runner implementation) is to throw specifically `BrainOutputValidationError`. The test should verify the error class to catch regressions where the wrong error type is thrown.
**Fix:**
```typescript
import { BrainOutputValidationError } from "@brain-pkg/shared";

// Line 355:
await expect(runner.run(makeEvent())).rejects.toThrow(BrainOutputValidationError);

// Line 374:
await expect(runner.run(makeEvent())).rejects.toThrow(BrainOutputValidationError);
```

### WR-04: `BrainError` does not call `Error.captureStackTrace` — stack traces may be incomplete

**File:** `packages/shared/src/errors/index.ts:4-11`
**Issue:** `BrainError` extends `Error` and calls `super(message)`, but does not call `Error.captureStackTrace(this, this.constructor)`. In V8 (Node.js/Bun), without `captureStackTrace`, the stack trace includes the `BrainError` constructor frames, making the trace noisier and harder to debug in production. This is a standard pattern for custom error classes in Node.js/Bun.
**Fix:**
```typescript
export class BrainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name; // use subclass name automatically
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
```
Note: the subclasses currently set `this.name` manually after `super()`. Moving `this.name = this.constructor.name` into `BrainError` removes the need for the three redundant assignments in subclasses.

---

## Info

### IN-01: `event.Name` vs field naming — `BrainEvent` field is `Name` but run() comment says `Name` — verify consistency

**File:** `packages/core/src/runner/runner.ts:160`
**Issue:** `runner.run()` at line 160 passes `event.Name` to `upsertLead`. The test at line 329 of `brain-runner.test.ts` asserts the third argument is `"Test User"` with `makeEvent()` returning `{ Name: "Test User" }`. This is internally consistent. However, the `IBrainRunnerLike` interface in `handler.ts` (line 18-25) accepts `BrainEvent` which has `Name` (capital N). This is consistent across the codebase. No bug — just a note to ensure downstream consumers always produce `Name` (not `name`) since TypeScript would not catch this at the HTTP boundary post-`safeParse`.
**Fix:** No code change needed. Confirm `BrainEventSchema` (in `webhook/events.ts`, not reviewed here) uses `.Name` as the exact field key, and that WhatsApp/CRM integrations are documented to send `Name` with capital N.

### IN-02: `buildGraph` typed as `any` in brain-echo — comment explains but suppression is broad

**File:** `apps/brain-echo/src/brain.ts:15`
**Issue:** `buildGraph(ctx: BrainBuildContext): any` uses `any` with an eslint-disable comment. The comment correctly documents why (StateGraph generic accumulation after `addNode`). This is a known TypeScript limitation with LangGraph's node-accumulating generics. Info only — it is documented and intentional, but worth tracking for when LangGraph.js improves its typings.
**Fix:** When upgrading `@langchain/langgraph` beyond `^1.4.1`, check if `StateGraph` generics have improved to allow a tighter return type. Until then, the `any` + eslint-disable pattern is acceptable given the explanation.

### IN-03: `handler.test.ts` is located outside `__tests__/` convention

**File:** `packages/transport/src/webhook/handler.test.ts`
**Issue:** Per CLAUDE.md conventions, all test files must be in a dedicated `__tests__/` folder within the package. `handler.test.ts` is at `packages/transport/src/webhook/handler.test.ts` — next to the implementation file. The auth tests are correctly placed in `packages/transport/src/__tests__/unit/webhook-auth.test.ts`. This is an inconsistency.
**Fix:** Move `packages/transport/src/webhook/handler.test.ts` to `packages/transport/src/__tests__/unit/webhook-handler.test.ts` and update any imports or test runner paths accordingly.

---

_Reviewed: 2026-06-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
