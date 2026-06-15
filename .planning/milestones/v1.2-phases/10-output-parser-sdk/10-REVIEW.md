---
phase: 10-output-parser-sdk
reviewed: 2026-06-15T04:47:07Z
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
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-15T04:47:07Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This phase delivers the structured `BrainOutput` contract (SDK-06): a Zod schema in `packages/core`, a pure TypeScript interface in `packages/shared`, integration into `BrainStateAnnotation`, validation in `BrainRunner.run()`, and a duck-typed `IBrainRunnerLike` interface in the transport layer. The overall design is sound and the separation of concerns (type in `shared`, Zod schema in `core`) correctly avoids the circular dependency pitfall documented in the research notes.

Three warnings were found, none security-critical. The most impactful is a logic divergence: `contextWindowSize` is computed in `runner.ts` purely for logging but the actual slicing is done independently inside the graph node, making the runner log misleading when the two computations disagree. The second warning covers `BrainOutputValidationError` being documented in runner comments as intended for "specific catch in handler.ts" but the handler always returns a generic 500, defeating the purpose. The third warning is a test coverage gap: D-14 tests assert `.rejects.toThrow()` without checking the error class, which means a wrong error type would silently pass. Three info items cover code duplication, a missing `captureStackTrace` pattern in the base error class, and a test file located outside the project's `__tests__/` convention.

---

## Warnings

### WR-01: `contextWindowSize` in `runner.ts` is computed but never used for slicing — log is misleading

**File:** `packages/core/src/runner/runner.ts:179-193`

**Issue:** `runner.ts` computes `contextWindowSize` via an identical ENV-parsing IIFE (lines 179-182) then only passes it to `logger.debug` (lines 192-193). The actual context window enforcement (the `.slice(-contextWindowSize)`) happens inside the graph node in `brain.ts` (line 32). The runner's `willTruncate` log compares `historicalMessages.length` (pre-invoke snapshot from PostgresSaver) against `contextWindowSize`, but the node slices `state.messages` at invocation time — which includes the new human message appended by LangGraph's reducer. The two counts differ by at least 1 on every non-empty conversation. The log says `willTruncate: false` on a 40-message conversation that will actually be truncated inside the node.

**Fix:** Remove the dead IIFE from `runner.ts` (lines 179-182). Log only the raw historical count:

```typescript
// HIST-03: Log historical message count; slicing is performed inside the graph node.
this.logger.debug(
  {
    threadId,
    historicalCount: historicalMessages.length,
  },
  "HIST-03: context window snapshot"
);
```

---

### WR-02: `BrainOutputValidationError` is not differentiated in `handler.ts` catch block

**File:** `packages/transport/src/webhook/handler.ts:85-89`

**Issue:** The comment in `runner.ts` (line 237) explicitly says the error is re-thrown "para catch específico em handler.ts". The handler catch block at lines 85-89 catches all `runner.run()` errors and unconditionally returns `500 Internal error`. `BrainOutputValidationError` is a contract violation from a Brain node — a deterministic programming error, not a transient infrastructure failure. Conflating the two makes alerting and debugging harder: a misconfigured Brain node produces the same 500 as a database outage.

**Fix:** Import `BrainOutputValidationError` from `@brain-pkg/shared` and differentiate:

```typescript
import { ConfigurationError, BrainOutputValidationError } from "@brain-pkg/shared";

// inside the runner catch block:
} catch (err) {
  if (err instanceof BrainOutputValidationError) {
    logger.error({ err }, "BrainOutput contract violation — Brain node did not set brainOutput");
    return c.json({ error: "Brain output error" }, 502);
  }
  logger.error({ err }, "BrainRunner.run() failed");
  return c.json({ error: "Internal error" }, 500);
}
```

Using `502` (Bad Gateway) differentiates a downstream Brain contract violation from a `500` infrastructure failure.

---

### WR-03: D-14 tests use `.rejects.toThrow()` without specifying error class — weak assertions

**File:** `packages/core/src/runner/__tests__/brain-runner.test.ts:387` and `406`

**Issue:** Both D-14 tests verify that `runner.run()` rejects:

```typescript
await expect(runner.run(makeEvent())).rejects.toThrow();
```

No argument is passed to `toThrow()`, so any thrown error — including an accidental `TypeError`, a `ConfigurationError`, or a plain `Error` — satisfies the assertion. The documented and implemented behaviour is to throw `BrainOutputValidationError` specifically. A regression that changes the error type would go undetected.

**Fix:** Assert the specific class:

```typescript
// Import in test file (or use string check as fallback):
await expect(runner.run(makeEvent())).rejects.toThrow(BrainOutputValidationError);
```

If importing `BrainOutputValidationError` triggers the zod initialization panic described in the test file header, use the error message string instead:

```typescript
await expect(runner.run(makeEvent())).rejects.toThrow("BrainOutput");
```

---

## Info

### IN-01: `contextWindowSize` ENV-parsing logic duplicated across two packages

**File:** `apps/brain-echo/src/brain.ts:28-31`, `packages/core/src/runner/runner.ts:179-182`

**Issue:** The identical IIFE pattern for parsing `CONTEXT_WINDOW_MESSAGES` exists verbatim in both files. If the fallback value (40) or validation logic changes, both must be updated synchronously. If WR-01 is addressed and the runner-side copy is removed, only one copy remains — but it should still be extracted to avoid re-introducing the duplication in future Brains.

**Fix:** Extract to a shared utility:

```typescript
// packages/shared/src/utils/env.ts
export function getContextWindowSize(): number {
  const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
  return n > 0 && isFinite(n) ? n : 40;
}
```

---

### IN-02: `BrainError` missing `Error.captureStackTrace` — constructor frames appear in stack traces

**File:** `packages/shared/src/errors/index.ts:4-11`

**Issue:** In V8 (Bun/Node.js), not calling `Error.captureStackTrace(this, this.constructor)` in a custom error constructor means the stack trace includes frames from `BrainError`, `ConfigurationError`, and `BrainOutputValidationError` constructors. This adds noise to production error logs. Also, the three subclasses each manually set `this.name`, which is redundant if the base class uses `this.constructor.name`.

**Fix:**

```typescript
export class BrainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name; // applies to all subclasses automatically
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
```

The three `this.name = '...'` assignments in subclasses can then be removed.

---

### IN-03: `handler.test.ts` is outside the `__tests__/` convention

**File:** `packages/transport/src/webhook/handler.test.ts`

**Issue:** CLAUDE.md requires all test files to be in a `__tests__/` subdirectory. `handler.test.ts` sits next to the implementation at `packages/transport/src/webhook/handler.test.ts`. The auth tests are correctly placed at `packages/transport/src/__tests__/unit/webhook-auth.test.ts`. This inconsistency may cause the test runner to miss or duplicate discovery depending on configuration.

**Fix:** Move `packages/transport/src/webhook/handler.test.ts` to `packages/transport/src/__tests__/unit/webhook-handler.test.ts` and update the import path from `"./handler.js"` to `"../../webhook/handler.js"`.

---

_Reviewed: 2026-06-15T04:47:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
