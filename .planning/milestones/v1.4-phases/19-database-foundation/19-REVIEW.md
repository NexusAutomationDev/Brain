---
phase: 19-database-foundation
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/core/src/leads/__tests__/lead-service.test.ts
  - packages/core/src/leads/lead-service.ts
  - packages/database/src/__tests__/integration/migration-v14.test.ts
  - packages/database/src/migrations/0007_v1_4_foundation.sql
  - packages/database/src/migrations/meta/_journal.json
  - packages/database/src/schema/tables.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/__tests__/runner-fup.test.ts
  - packages/core/src/runner/runner.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase delivers the database foundation for the FUP (follow-up) scheduler: a new migration (`0007_v1_4_foundation`) adds four columns to `leads`, two new tables (`knowledge_chunks`, `fup_config`), and corresponding Drizzle schema definitions. `LeadService` gains `touchLastMessage()`, and `BrainRunner.run()` calls it unconditionally before the `ia_ativada` gate. Tests cover the new behaviour across three test files.

The overall implementation is sound. No critical security issues or data-loss bugs were found. Four warnings were identified — one behavioural bug in `runner.ts` (SIGTERM handler leak on repeated `init()` calls), one schema/migration mismatch (`fupEnabled` default value), one timestamp precision inconsistency in `fup_config`, and one stale mock shape in `brain-runner.test.ts`. Three informational items round out the review.

---

## Warnings

### WR-01: SIGTERM handler leaks on every `init()` call — multiple handlers accumulate

**File:** `packages/core/src/runner/runner.ts:130`

**Issue:** `process.on('SIGTERM', ...)` is registered unconditionally inside `init()`. `init()` is also called internally by `_compileGraph()` via `refreshPrompts()` (line 153) and via the MCP TTL reconnect path inside `run()` (line 179). Each call to `refreshPrompts()` or `run()` after MCP session expiry registers an additional SIGTERM listener. After N calls, there are N handlers. Node/Bun emits a `MaxListenersExceededWarning` after 10 listeners. More critically, `close()` is called N times on shutdown — the second call tries to close an already-nulled `mcpClient` (safe, it's a null check), but the multiple `process.exit(0)` calls in sequence produce undefined shutdown behaviour.

**Fix:** Move the SIGTERM registration to a one-time guard, or use `process.once`:

```typescript
// In init(), replace:
process.on('SIGTERM', async () => { ... });

// With a one-time guard:
if (!this._sigtermRegistered) {
  this._sigtermRegistered = true;
  process.on('SIGTERM', async () => {
    this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
    await this.close();
    process.exit(0);
  });
}
```

Add `private _sigtermRegistered = false;` to the class fields. Alternatively, use `process.once` if `init()` is guaranteed to be called only once per process lifetime — but the current code allows multiple calls, so the guard is safer.

---

### WR-02: `fup_enabled` DEFAULT mismatch between migration SQL and Drizzle schema

**File:** `packages/database/src/migrations/0007_v1_4_foundation.sql:25` / `packages/database/src/schema/tables.ts:93`

**Issue:** The migration adds the column with `DEFAULT false`:

```sql
ALTER TABLE "leads" ADD COLUMN "fup_enabled" boolean DEFAULT false NOT NULL;
```

The Drizzle schema also declares `default(false)`. These agree. However, the `fupConfig` table's `enabled` column has `DEFAULT true` in **both** the migration SQL and the Drizzle schema, while the architectural decision log (FUP-01 / D-16 comment in tables.ts line 119) states the `enabled` flag controls whether FUP is active for a `brain_type`. A new `fup_config` row inserted without explicitly setting `enabled` will be active by default — this is the intended default (`true`), but it is not validated by any CHECK constraint. If `min_hour > max_hour` is inserted (e.g., `min_hour=22, max_hour=6` for overnight windows), the scheduler will silently produce no schedule slots.

**Fix:** Add a CHECK constraint to `fup_config` to enforce `min_hour < max_hour` and valid hour range (0–23):

```sql
-- Add to migration after fup_config CREATE TABLE:
ALTER TABLE "fup_config"
  ADD CONSTRAINT fup_config_hours_check
  CHECK (min_hour >= 0 AND max_hour <= 23 AND min_hour < max_hour);
```

In the Drizzle schema (`tables.ts`), add:

```typescript
import { check } from 'drizzle-orm/pg-core';
// inside pgTable fupConfig definition:
}, (table) => ({
  hoursCheck: check('fup_config_hours_check',
    sql`${table.minHour} >= 0 AND ${table.maxHour} <= 23 AND ${table.minHour} < ${table.maxHour}`
  ),
}));
```

---

### WR-03: Journal `when` timestamp for migration 0007 is earlier than 0006 — breaks chronological ordering assumption

**File:** `packages/database/src/migrations/meta/_journal.json:57`

**Issue:** Entry `idx=7` has `"when": 1750000000000` (Unix ms = **June 2025**). Entry `idx=6` has `"when": 1781793280000` (Unix ms = **June 2026**). Migration `0007` is timestamped ~12 months *before* `0006`. While Drizzle's migration runner orders by `idx` (not `when`), any tooling or monitoring that sorts or filters by `when` will incorrectly place 0007 before all previous migrations. Manual auditing of "when was this schema change applied" will also be misleading for the entire team.

**Fix:** Update the `when` field for entry `idx=7` to a value after 0006 (e.g., `1781793300000` or the actual current epoch ms):

```json
{
  "idx": 7,
  "version": "7",
  "when": 1782000000000,
  "tag": "0007_v1_4_foundation",
  "breakpoints": true
}
```

---

### WR-04: `brain-runner.test.ts` mock lead object is missing FUP columns — type mismatch will cause silent `undefined` access if runner code accesses them

**File:** `packages/core/src/runner/__tests__/brain-runner.test.ts:105-114`

**Issue:** The `mockUpsertLead` default mock return value (lines 105–114) and the inline overrides (e.g., lines 292–301, 397–406) do not include `fupEnabled`, `fupStep`, `fupNextAt`, `lastMessageAt`, `idDeal`, or `idContato`. The `Lead` type (derived from `leads.$inferSelect`) now includes these columns. If future `runner.ts` code accesses `lead.fupEnabled` or `lead.lastMessageAt`, tests will return `undefined` silently rather than a type-correct value, masking regressions.

The `runner-fup.test.ts` file correctly includes all new columns (lines 83–90) — `brain-runner.test.ts` was not updated to match.

**Fix:** Add the missing fields to all mock lead objects in `brain-runner.test.ts`:

```typescript
const mockUpsertLead = mock(async () => ({
  id: "uuid-1",
  uniqueId: "lead-abc",
  numero: "5511999990001",
  nome: "Test User",
  iaAtivada: true,
  fullpp: null,
  idDeal: null,
  idContato: null,
  fupEnabled: false,
  fupStep: 0,
  fupNextAt: null,
  lastMessageAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
```

Apply the same additions to all `mockImplementationOnce` overrides within the file.

---

## Info

### IN-01: `knowledge_chunks` embedding dimension is hardcoded to `vector(1536)` in migration SQL but reads from ENV in Drizzle schema

**File:** `packages/database/src/migrations/0007_v1_4_foundation.sql:5`

**Issue:** The migration creates `"embedding" vector(1536)` with a literal dimension, while `tables.ts` line 111 uses `vector('embedding', { dimensions: EMBEDDING_DIM })` where `EMBEDDING_DIM` comes from `process.env.EMBEDDING_DIMENSIONS`. If a deployment uses a different embedding model (e.g., 3072 dimensions for `text-embedding-3-large`), the schema and the actual column definition will diverge. The existing `embeddings` table has the same pattern (migration 0000 presumably hardcoded 1536) — this is a known constraint per `CLAUDE.md` ("Cannot be changed after first migration without re-embedding all data"), but the asymmetry is worth noting so it doesn't surprise the next contributor.

**Fix:** Document this constraint in the migration file header as a comment:

```sql
-- WARNING: embedding dimension hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Changing requires dropping and recreating the column plus re-embedding all data.
-- Must match EMBEDDING_DIMENSIONS ENV at deployment time.
```

---

### IN-02: `getByNumero` in `LeadService` is untested in the new test suite

**File:** `packages/core/src/leads/__tests__/lead-service.test.ts`

**Issue:** `LeadService.getByNumero()` exists in `lead-service.ts` (lines 66–73) and was part of the original contract (D-02 comment). It is not exercised by any test in the current suite. The mock for `mockSelect`/`mockFrom`/`mockWhere`/`mockLimit` is set up but never asserted against (the mock returns `[]` and no test calls `getByNumero`). The method is used in the runner only via `upsertLead`, so the gap does not affect production coverage now, but it creates a blind spot.

**Fix:** Add a test case:

```typescript
it("getByNumero() retorna null quando lead não existe", async () => {
  const result = await service.getByNumero("5511999990001");
  expect(result).toBeNull();
});
```

---

### IN-03: `runner-fup.test.ts` mocks `@brain-pkg/shared` but `brain-runner.test.ts` does not — inconsistent mock strategy across test files

**File:** `packages/core/src/runner/__tests__/runner-fup.test.ts:68-71`

**Issue:** `runner-fup.test.ts` explicitly mocks `@brain-pkg/shared` to provide `ConfigurationError` and `BrainOutputValidationError` (lines 68–71). `brain-runner.test.ts` does not mock this module and relies on the real implementation loading. While both approaches work today, the inconsistency makes it harder to reason about test isolation strategy. The comment in `brain-runner.test.ts` (lines 461–462) also notes that class imports are avoided due to a zod v4 panic in bun 1.3.2, which the `runner-fup.test.ts` mock sidesteps cleanly.

**Fix:** Align `brain-runner.test.ts` to also mock `@brain-pkg/shared` the same way as `runner-fup.test.ts`, and remove the workaround comment on lines 461–462 since the mock eliminates the underlying concern.

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
