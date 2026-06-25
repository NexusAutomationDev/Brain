---
phase: 26-fup-next-at-init-fix
reviewed: 2026-06-25T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
  - packages/core/src/leads/__tests__/lead-service.test.ts
  - packages/core/src/fup/fup-scheduler.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-06-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Review covers the Phase 26 implementation of `fupNextAt` initialization on INSERT (`lead-service.ts`), the business-hours slot calculator (`fup-scheduler.ts` — `getNextValidSlot`), and the two test suites (`lead-service-fup.test.ts` and `leads/__tests__/lead-service.test.ts`).

The core logic is correct: `fupNextAt` is calculated at INSERT time using `getNextValidSlot`, excluded from the `onConflictDoUpdate` SET, and properly reset by `resetFup()`. The two-transaction locking design in `_tick()` is sound and well-documented.

Two warnings are raised: one is a latent SQL injection vector in `fup-scheduler.ts` using `tx.unsafe()`, and one is a test coverage gap where the UPDATE path test does not assert the `fup_config` SELECT is skipped. Three info items cover type inconsistencies and misleading fixture data.

## Warnings

### WR-01: `tx.unsafe()` with ENV-injectable constant in interval UPDATE

**File:** `packages/core/src/fup/fup-scheduler.ts:129`
**Issue:** `tx.unsafe(String(FUP_PROCESSING_LOCK_MINUTES))` injects a numeric constant into a raw SQL INTERVAL literal using `tx.unsafe()`. Today `FUP_PROCESSING_LOCK_MINUTES` is a module-level constant (`10`), so there is no injection risk. However, comments in the file at line 30 explicitly call out `D-05` ENV configurability for `FUP_POLL_INTERVAL_MS` — there is a clear pattern of converting constants to ENV variables. If `FUP_PROCESSING_LOCK_MINUTES` is ever made ENV-driven without sanitization, `tx.unsafe()` becomes a SQL injection path. PostgreSQL supports parameterized intervals via `make_interval()`.

**Fix:**
```sql
-- Replace:
SET fup_next_at = NOW() + INTERVAL '${tx.unsafe(String(FUP_PROCESSING_LOCK_MINUTES))} minutes'

-- With (parameterized — safe regardless of source):
SET fup_next_at = NOW() + make_interval(mins => ${FUP_PROCESSING_LOCK_MINUTES})
```

In `postgres.js` tagged template syntax:
```typescript
await tx`
  UPDATE leads
  SET fup_next_at = NOW() + make_interval(mins => ${FUP_PROCESSING_LOCK_MINUTES}),
      updated_at = NOW()
  WHERE unique_id = ANY(${uniqueIds})
`;
```

### WR-02: UPDATE path test does not assert fup_config SELECT is skipped

**File:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts:208-232`
**Issue:** The test "UPDATE (lead existente) não altera fupNextAt" verifies that `values()` receives `fupEnabled=false` and `fupNextAt=null`, but does NOT assert that `selectMock` was called exactly once (i.e., that the fup_config SELECT was skipped). The comment on line 224 states "No UPDATE path, a fup_config NÃO deve ser consultada (isInsert=false)" — this is a design constraint (D-02/D-04) but it goes unverified. If `upsertLead` were accidentally changed to query fup_config on UPDATE, this test would still pass.

**Fix:** Add an assertion on the select call count after the `upsertLead` call:
```typescript
// After: await service.upsertLead("5511999990004", ...)
// Assert only 1 SELECT was issued (existing lead check; fup_config skipped)
expect(mocks.selectMock).toHaveBeenCalledTimes(1);
```

Note: `mocks.selectMock` is currently not exposed by `makeLeadServiceForUpsert` return. Expose it from the factory:
```typescript
return { service, ...mocks };
// mocks already contains selectMock from makeUpsertDbMock
```

## Info

### IN-01: `fupFailureCount` typed as `number` but guarded with nullish coalescing

**File:** `packages/core/src/fup/fup-scheduler.ts:258`
**Issue:** `(lead.fupFailureCount ?? 0) + 1` — `fupFailureCount` is typed as `number` (not `number | null`) in `FupLeadRow` at line 337. The `?? 0` guard is dead code and suggests uncertainty about the actual database return type. If the column is `NOT NULL DEFAULT 0` in schema, the type should be `number` and the guard is unnecessary. If it can be null (nullable column), `FupLeadRow` should type it as `number | null`.

**Fix:** Confirm column nullability from schema and align the type:
```typescript
// If NOT NULL (most likely):
interface FupLeadRow {
  fupFailureCount: number;  // already correct — remove ?? 0 guard
}
const newCount = lead.fupFailureCount + 1;

// If nullable:
interface FupLeadRow {
  fupFailureCount: number | null;
}
// keep ?? 0 guard
```

### IN-02: Misleading fixture value in Phase 25 test — `fupNextAt: null` when `fupEnabled: true`

**File:** `packages/core/src/leads/__tests__/lead-service.test.ts:235`
**Issue:** The mock return value for "INSERT com fup_config enabled=true" has `fupEnabled: true` but `fupNextAt: null`. Per Phase 26 invariant, a lead with `fupEnabled=true` created on INSERT must have `fupNextAt` set to a `Date` (not null). The fixture is technically valid for testing `fupEnabled` in isolation (the test only asserts `lead.fupEnabled === true`), but it creates a misleading picture of what the real database would return — and could mask regressions in the Phase 26 logic if the test is later adapted.

**Fix:** Update the `fupNextAt` value in the `mockReturning` for this test case to a `Date`:
```typescript
mockReturning.mockImplementationOnce(async () => [
  {
    ...
    fupEnabled: true,
    fupNextAt: new Date(),  // Phase 26: non-null when fupEnabled=true on INSERT
    ...
  },
]);
```

### IN-03: `selectCallCount` counter in `makeUpsertDbMock` is closure-local — resets per test but not reset if mock is reused

**File:** `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts:112`
**Issue:** The `selectCallCount` variable in `makeUpsertDbMock` is captured in the `limitMock` closure. Since each test calls `makeLeadServiceForUpsert()` which calls `makeUpsertDbMock()`, a fresh closure is created per test — so there is no cross-test contamination. However, if the same `service` instance were reused across multiple `upsertLead` calls in a single test, `selectCallCount` would not reset between calls and the SELECT routing (lead vs fup_config) would break on the third call onwards. This is not a current bug but is a fragile design that could cause confusing failures if tests are extended.

**Fix:** Add a comment documenting this constraint, or restructure `limitMock` to track call count per `upsertLead` call (e.g., reset before each `upsertLead` invocation in the mock factory documentation):
```typescript
// NOTE: selectCallCount is NOT reset between multiple upsertLead() calls on the same service.
// Each test must use a freshly constructed service from makeLeadServiceForUpsert().
```

---

_Reviewed: 2026-06-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
