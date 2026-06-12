---
phase: 02-domain-packages
plan: "07"
subsystem: observability
tags: [langfuse, tracing, callbacks, observability, OBS-03]
dependency_graph:
  requires: ["02-03", "02-06"]
  provides: ["createTracingCallbacks", "TracingContext"]
  affects: ["packages/observability"]
tech_stack:
  added:
    - "@langfuse/langchain@^5.4.1 (Langfuse LangChain callback integration)"
    - "@opentelemetry/api@^1.9.0 (devDependency — peer dep of @langfuse/langchain)"
  patterns:
    - "Conditional env-var guard pattern (D-02: silent no-op when keys absent)"
    - "mock.module() for isolating external SDK in bun:test (D-09)"
key_files:
  created:
    - packages/observability/src/tracing.ts
  modified:
    - packages/observability/package.json
    - packages/observability/src/tracing.test.ts
    - packages/observability/src/index.ts
decisions:
  - "D-02: createTracingCallbacks returns [] when either Langfuse key absent — no startup failure"
  - "D-01: Langfuse chosen over LangSmith (AsyncLocalStorage gaps on Bun)"
  - "brainId surfaced as tags (brain:<id>) in Langfuse rather than a root field — CallbackHandler API accepts tags array"
  - "@opentelemetry/api installed as devDependency only — avoids shipping OTEL in production bundles"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-11"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
requirements_satisfied: [OBS-03]
---

# Phase 2 Plan 07: Langfuse Tracing Integration Summary

**One-liner:** Conditional Langfuse CallbackHandler integration via `createTracingCallbacks()` — returns `[CallbackHandler]` when env keys present, empty array otherwise (D-02 silent fallback).

## What Was Built

Added Langfuse observability tracing to `packages/observability`. The integration activates only when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are both set in the environment. When either is absent, the function returns an empty array with no error or log output, satisfying the D-02 design decision (Brain instances must start without observability config in development).

The returned `CallbackHandler[]` is designed to be passed directly to LangGraph `graph.invoke()`:

```typescript
const callbacks = createTracingCallbacks({ sessionId, userId, brainId: "sdr" });
await graph.invoke(input, { configurable: { thread_id: sessionId }, callbacks });
```

## Tasks Completed

### Task 1: Install Langfuse deps and implement createTracingCallbacks (OBS-03)

**Commit:** `5be730f`
**Files:** `packages/observability/package.json`, `packages/observability/src/tracing.ts`

- Added `@langfuse/langchain@^5.4.1` to `dependencies`
- Added `@opentelemetry/api@^1.9.0` to `devDependencies` (peer dep — dev-only avoids OTEL in prod bundles)
- Created `tracing.ts` with `createTracingCallbacks(context?: TracingContext): CallbackHandler[]`
- Conditional guard on `LANGFUSE_PUBLIC_KEY` AND `LANGFUSE_SECRET_KEY` — both must be present
- `brainId` surfaced via `tags: ["brain:<id>"]` in Langfuse (CallbackHandler accepts `tags` array)
- `LANGFUSE_SECRET_KEY` never logged, never returned — only used in conditional check

### Task 2: Write tracing tests and update observability barrel (OBS-03)

**Commit:** `2ae9bfb`
**Files:** `packages/observability/src/tracing.test.ts`, `packages/observability/src/index.ts`

- Replaced stub `it.todo()` tests with 6 concrete assertions
- Tests cover D-02 fallback (no PUBLIC_KEY, no SECRET_KEY, both absent)
- Tests cover happy path (both keys present → `[CallbackHandler]`)
- Verifies `flushAsync` method exists on returned handler (RESEARCH.md Pitfall 4 compliance)
- Verifies `LANGFUSE_SECRET_KEY` value does not appear in serialized callback (T-2-03)
- Uses `mock.module("@langfuse/langchain", ...)` for full SDK isolation (D-09 pattern)
- Added `export { createTracingCallbacks }` and `export type { TracingContext }` to barrel

## Deviations from Plan

None — plan executed exactly as written.

The only discretionary decision was surfacing `brainId` via `tags: ["brain:<id>"]` rather than a direct field, since the `CallbackHandler` constructor accepts `tags` but not `brainId` directly. This is noted in the decisions section.

## Known Stubs

None — `createTracingCallbacks` is fully wired. Returns real `CallbackHandler` instance when keys are present, empty array otherwise. No placeholder data flows to any consumer.

## Threat Flags

No new security surface introduced beyond what was planned in the threat model. `LANGFUSE_SECRET_KEY` handling verified:
- Used only in conditional boolean check (`!process.env.LANGFUSE_SECRET_KEY`)
- Never passed to `createLogger()` or any logging call
- Never included in error messages
- Never serialized into returned objects
- Test T-2-03 enforces this at unit test level

## Self-Check: PASSED

- `packages/observability/src/tracing.ts` — EXISTS
- `packages/observability/src/tracing.test.ts` — EXISTS (6 tests)
- `packages/observability/src/index.ts` — contains `createTracingCallbacks` export
- `packages/observability/package.json` — contains `@langfuse/langchain`
- Commit `5be730f` — feat(02-07) tracing implementation
- Commit `2ae9bfb` — test(02-07) tracing tests and barrel
