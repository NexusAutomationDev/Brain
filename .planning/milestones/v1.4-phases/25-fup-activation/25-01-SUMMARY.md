---
phase: 25-fup-activation
plan: "01"
subsystem: core/leads
tags: [tdd, red-phase, fup, lead-service, testing]
dependency_graph:
  requires: []
  provides: [fup-activation-test-contract]
  affects: [packages/core/src/leads/__tests__/lead-service.test.ts]
tech_stack:
  added: []
  patterns: [tdd-red-phase, bun-test-mocking, chain-mock-pattern]
key_files:
  created: []
  modified:
    - packages/core/src/leads/__tests__/lead-service.test.ts
decisions:
  - "Test 4 passes as invariant guard (D-03: UPDATE must never set fupEnabled) — acceptable in RED phase; the constraint already holds and must remain"
  - "mockSelect4 chain created separately from existing mockSelect to avoid interference with getByNumero mock chain"
  - "Tests verify SELECT call count + VALUES content (not just return value) — ensures implementation wires fup_config query correctly"
metrics:
  duration: 254s
  completed: "2026-06-25"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 25 Plan 01: FUP Activation Test Stubs Summary

**One-liner:** RED test suite for FUP activation logic — 5 cases verifying that upsertLead() consults fup_config and sets fupEnabled in VALUES on INSERT, never on UPDATE.

## What Was Built

Added a new `describe` block "LeadService — FUP activation (Phase 25)" with 5 test cases to `packages/core/src/leads/__tests__/lead-service.test.ts`. These tests define the behavioral contract that Wave 1 implementation must satisfy.

### Test Cases

| # | Name | Assertion | Status |
|---|------|-----------|--------|
| 1 | INSERT + config enabled | `mockSelect4` called once; `mockValues` has `fupEnabled: true` | FAIL (RED) |
| 2 | INSERT + config disabled | `mockSelect4` called once; `mockValues` has `fupEnabled: false` | FAIL (RED) |
| 3 | INSERT without brainType | `mockSelect4` NOT called; `mockValues` has `fupEnabled: false` | FAIL (RED) |
| 4 | UPDATE preserves fupEnabled | `onConflictDoUpdate.set` does NOT have `fupEnabled` | PASS (invariant guard) |
| 5 | INSERT + nonexistent config | `mockSelect4` called once; `mockValues` has `fupEnabled: false`; no exception thrown | FAIL (RED) |

### Mock Infrastructure Added

- `fupConfig` table mock added to `@brain-pkg/database` module mock (brainType PK, enabled boolean, plus all other columns)
- `mockSelect4 / mockFrom4 / mockWhere4 / mockLimit4` — separate SELECT chain for fup_config queries; does not interfere with existing SELECT chain used by `getByNumero`
- Existing `mockReturning` base return value extended with new Lead schema fields (`fupEnabled`, `fupStep`, `fupNextAt`, `lastMessageAt`, `fupFailureCount`, `idDeal`, `idContato`)

### Test Strategy

Tests verify **call count + argument content** rather than just return values:
- `expect(mockSelect4).toHaveBeenCalledTimes(1)` — ensures implementation actually queries fup_config
- `expect(valuesArg).toHaveProperty("fupEnabled", true/false)` — ensures implementation passes fupEnabled in the INSERT VALUES (not a post-hoc patch)

This approach causes Tests 1, 2, 3, 5 to FAIL immediately (RED) because the current `upsertLead()` neither accepts `brainType` nor queries `fup_config`.

## Decisions Made

**Test 4 passes in RED phase (intentional):** Test 4 validates D-03 (UPDATE must NOT set fupEnabled). The current implementation already satisfies this because `fupEnabled` was never in the `set` object. This is an invariant guard — it documents that the future implementation must not accidentally add `fupEnabled` to the UPDATE SET. Acceptable to pass in RED.

**Separate mock chain for fup_config SELECT:** The existing `mockSelect` chain feeds `getByNumero()`. Creating a distinct `mockSelect4` chain and replacing `mockDb.select` in the Phase 25 `beforeEach` gives full control over fup_config query responses per test without breaking the existing SELECT pattern.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

```
bun test packages/core/src/leads/__tests__/lead-service.test.ts -t "FUP activation"
```

Result: **5 tests ran — 1 pass, 4 fail** (RED phase as expected)

Full suite: **13 tests ran — 9 pass, 4 fail** (existing tests unaffected)

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `packages/core/src/leads/__tests__/lead-service.test.ts` exists | FOUND |
| `.planning/phases/25-fup-activation/25-01-SUMMARY.md` exists | FOUND |
| Commit `d8b8f86` exists | FOUND |
| File has >= 200 lines | 385 lines |
| describe block "LeadService — FUP activation (Phase 25)" present | 1 occurrence |
| 5 new test cases added | Confirmed (13 total = 8 existing + 5 new) |
| Tests 1/2/3/5 FAIL (RED) | Confirmed |
| Test 4 PASS (invariant guard) | Confirmed |
| Existing 9 tests still pass | Confirmed |
