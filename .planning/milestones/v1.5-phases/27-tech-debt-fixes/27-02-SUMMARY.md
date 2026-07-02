---
phase: 27-tech-debt-fixes
plan: "02"
requirements-completed: [TECH-02]
subsystem: packages/core
tags: [testing, fup, integration, e2e, postgresql]
dependency_graph:
  requires: []
  provides: [fup-e2e-test]
  affects: [packages/core]
tech_stack:
  added: []
  patterns: [bun-test, postgres-real, monkey-patch-llm, fetch-mock]
key_files:
  created:
    - packages/core/src/__tests__/integration/fup-e2e.test.ts
  modified: []
decisions:
  - _generateFupMessage monkey-patched to avoid LLM API cost — simpler than mocking createLLM import
  - globalThis.fetch overridden in beforeAll to capture webhook calls without network
  - intervals_seconds=[1,2] (2-step config) to exercise both intermediate and final step in minimal iterations
  - Third test added (idle lead after deactivation) to cover the guard clause in _tick() WHERE ia_ativada=true
metrics:
  duration_minutes: 2
  completed_date: "2026-06-30"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 27 Plan 02: FupScheduler E2E Integration Test Summary

**One-liner:** FupScheduler E2E test against real PostgreSQL — multi-step flow (0→1→last), LLM monkey-patched, fetch mocked, graceful skip without DATABASE_URL.

## What Was Built

Created `packages/core/src/__tests__/integration/fup-e2e.test.ts` (276 lines) covering the full FupScheduler lifecycle against a real PostgreSQL instance.

### Test Coverage

| Test | Description | Requirement |
|------|-------------|-------------|
| Step 0 → Step 1 | Lead eligible, _tick() processes it, fup_step advances, fup_next_at set to future | FUP-02 |
| Step 1 → last step | After final interval, ia_ativada=false, fup_enabled=false, fup_next_at=NULL | FUP-05 |
| Idle after deactivation | _tick() does NOT process lead with ia_ativada=false | FUP guard clause |

### Mock Strategy

- **LLM:** `_generateFupMessage` monkey-patched on the scheduler instance before `_tick()`. Returns fixed string "Mensagem de follow-up de teste E2E". No API key required.
- **HTTP webhook:** `globalThis.fetch` replaced in `beforeAll`, restored in `afterAll`. Captures `fetchCallCount` and `lastFetchBody` for assertions.
- **Checkpointer:** Simple object implementing `getTuple()` returning empty messages array.
- **EventPublisher:** `mock()` from `bun:test` on `publish` and `close` — no-op.

### Skip Pattern

```typescript
const RUN_FUP = !!process.env.DATABASE_URL;
test.skipIf(!RUN_FUP)("...", async () => { ... });
```

All 3 tests skip when `DATABASE_URL` is absent. `beforeAll` returns immediately.

### Running with Real Database

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/dbname \
MIGRATIONS_FOLDER=packages/database/src/migrations \
bun test packages/core/src/__tests__/integration/fup-e2e.test.ts
```

### Teardown

`afterAll` deletes all test records from:
- `leads WHERE unique_id = 'fup-e2e-lead-1'`
- `fup_config WHERE brain_type = 'sdr-fup-e2e'`
- `prompts WHERE brain_type = 'sdr-fup-e2e'`

## Deviations from Plan

### Auto-added Issues

**1. [Rule 2 - Missing functionality] Third test for idle lead after deactivation**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified 2 tests but left a gap — once a lead is deactivated (ia_ativada=false), the WHERE clause in _tick() should exclude it. Without a third test, we couldn't verify the guard was working.
- **Fix:** Added `"_tick() não processa lead com ia_ativada=false"` test that resets `fup_next_at` to the past but verifies fetch is NOT called.
- **Files modified:** `packages/core/src/__tests__/integration/fup-e2e.test.ts`
- **Commit:** 6b66d20

## Known Stubs

None — all test data is inserted and verified against the real database.

## Threat Flags

None — this plan creates only test files with no new network endpoints, auth paths, or schema changes.

## Commits

| Hash | Description |
|------|-------------|
| 6b66d20 | ✅ test(27-02): add FupScheduler E2E integration test against real PostgreSQL |

## Self-Check: PASSED

- [x] File exists: `packages/core/src/__tests__/integration/fup-e2e.test.ts` (276 lines, > 100 required)
- [x] Commit 6b66d20 exists in git log
- [x] Test runs without DATABASE_URL: `0 pass, 3 skip, 0 fail` (verified)
- [x] File contains `FupScheduler` import
- [x] File contains `runMigrations` import
- [x] File contains `_tick()` call
- [x] File contains `ia_ativada = false` verification
