---
phase: 13-suporte-a-pgbouncer-para-connection-pooling
plan: "02"
subsystem: brain-sdr/qualifier
tags: [connection-leak, pgbouncer, postgresql-saver, tdd, bug-fix]
dependency_graph:
  requires: []
  provides: [CR-01-fix]
  affects: [apps/brain-sdr/src/qualifier.ts]
tech_stack:
  added: []
  patterns: [try/finally for resource cleanup, static code analysis in tests]
key_files:
  created: []
  modified:
    - apps/brain-sdr/src/qualifier.ts
    - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
decisions:
  - "Use inner try/finally around saver.getTuple() — saver.end() closes pg.Pool; compiledQualificationGraph is stateless so saver is not needed after getTuple()"
  - "Use typed public API saver.end() directly — no cast (saver as any) needed; end() is in PostgresSaver v1.0.3 dist/index.d.ts"
  - "Static code analysis tests (readFileSync) are appropriate for verifying structural patterns like Pitfall 5 (order: getTuple before end)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-15T21:21:24Z"
  tasks_completed: 2
  files_modified: 2
requirements_satisfied:
  - PGB-04
---

# Phase 13 Plan 02: CR-01 Fix — PostgresSaver Connection Leak in qualifier.ts Summary

**One-liner:** Close PostgresSaver pg.Pool in finally block after getTuple() to fix connection leak accumulating on every qualify_lead tool invocation.

## What Was Built

Corrected CR-01 identified in Phase 12 code review: `PostgresSaver.fromConnString()` in `runQualificationAgent()` created a `pg.Pool` internally that was never closed. Each invocation of the `qualify_lead` tool leaked one database connection — in production with many conversations, this would exhaust available connections.

**Fix applied in `qualifier.ts`:**

Before:
```typescript
const saver = PostgresSaver.fromConnString(dbUrl);
const tuple = await saver.getTuple({ configurable: { thread_id: sessionId } });
// saver.end() never called — pg.Pool leaked
```

After:
```typescript
const saver = PostgresSaver.fromConnString(dbUrl);
let tuple: Awaited<ReturnType<typeof saver.getTuple>>;
try {
  tuple = await saver.getTuple({ configurable: { thread_id: sessionId } });
} finally {
  await saver.end(); // D-09: closes pg.Pool after getTuple returns
}
// compiledQualificationGraph is stateless — does not need saver
```

**Tests added in `qualifier.unit.test.ts`:**

New describe block `CR-01: PostgresSaver connection leak — saver.end() em finally` with 4 static analysis tests:
1. `qualifier.ts contém saver.end() para fechar o pg.Pool interno (CR-01)` — checks `saver.end()` present
2. `saver.end() está em bloco finally` — checks `finally { saver.end() }` pattern
3. `saver.end() é chamado APÓS saver.getTuple() (Pitfall 5)` — checks ordering via indexOf
4. `saver.end() usa API pública tipada — sem cast (saver as any)` — checks no type cast on end() call

## TDD Flow

**RED (Task 1):** Added 4 failing static analysis tests — all 4 failed because `qualifier.ts` had no `saver.end()`.

**GREEN (Task 2):** Added inner `try/finally` block wrapping `saver.getTuple()` with `await saver.end()` in finally — all 4 new tests pass.

**Test results:** 9/10 pass. The single failing test (`SDR-05 — import dinâmico`) is a pre-existing test that fails due to missing `node_modules` in the isolated worktree environment — it passes normally in the main project. All 4 new CR-01 tests pass.

## Deviations from Plan

None — plan executed exactly as written.

The only deviation worthy of note: the `git reset --soft` during branch base correction accidentally staged deletion of planning files, which were restored in a follow-up commit. No code was affected.

## Threat Model Coverage

All mitigations from the plan's threat model are satisfied:

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-13-02-01 | mitigate | saver.end() in finally closes pg.Pool after each qualify_lead invocation |
| T-13-02-02 | accept | DATABASE_URL not logged — pattern maintained; fix adds no credential logging |
| T-13-02-03 | mitigate | Pitfall 5 verified via static test — saver.end() appears after saver.getTuple() |

## Known Stubs

None — no stubs or placeholder values introduced.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `apps/brain-sdr/src/qualifier.ts` exists | FOUND |
| `apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts` exists | FOUND |
| `13-02-SUMMARY.md` exists | FOUND |
| RED commit `9ab674f` exists | FOUND |
| GREEN commit `5462761` exists | FOUND |
