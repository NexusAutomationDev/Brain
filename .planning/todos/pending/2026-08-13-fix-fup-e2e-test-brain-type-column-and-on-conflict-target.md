---
created: 2026-08-13T17:00:00.000Z
title: Fix fup-e2e.test.ts — inserts nonexistent leads.brain_type column, invalid ON CONFLICT target
area: testing
files:
  - packages/core/src/__tests__/integration/fup-e2e.test.ts
---

## Problem

Found during Phase 33's code review (`.planning/phases/33-seed-por-tipo-de-brain/33-REVIEW.md`, CR-01/CR-02). Pre-existing, introduced in commit `fe678ba` ("test(core): make fup-e2e tests independent (D-12)"), well before Phase 33 — confirmed via `git log`/`git show --stat` that Phase 33's only touch to this file (`d56027e`, 33-03) is a 3-line unrelated addition (a no-op `injectMessage` mock).

**CR-01:** `insertLead()` (lines 99-124) does:
```sql
INSERT INTO leads (unique_id, nome, numero, brain_type, fup_enabled, ia_ativada, fup_step, fup_next_at)
VALUES (..., ${BRAIN_TYPE}, ...)
```
but `leads` has no `brain_type` column anywhere in the schema or migrations (`packages/database/src/schema/tables.ts`, all `packages/database/src/migrations/*.sql`). `LeadService.upsertLead()` never writes one either — the architecture scopes brain type via `fup_config`/`prompts`/seed folder, not per-lead (one DB per Brain type). Running this test against any real PostgreSQL instance throws `column "brain_type" of relation "leads" does not exist` in `insertLead()`.

**CR-02:** Both `INSERT` branches end with `ON CONFLICT (unique_id) DO UPDATE SET ...`, but `leads.unique_id` (`schema/tables.ts:81`) is `.notNull()` only — no unique/exclusion constraint. The only real unique constraint is `leads_numero_unique_idx` on `numero`. Postgres requires the `ON CONFLICT` target to match an existing constraint, so this raises `there is no unique or exclusion constraint matching the ON CONFLICT specification` — independent of, and in addition to, CR-01. Compounding this: all three tests reuse the same hardcoded `LEAD_NUMERO = "5511000000001"`, so even fixing the `ON CONFLICT` target alone would then collide on `leads_numero_unique_idx` across the second/third test.

**Net effect:** this "E2E test against real PostgreSQL" (FUP-02/FUP-05 coverage) has never actually run successfully against a real database since D-12 — it only "passes" today by silently skipping whenever `DATABASE_URL`/`POSTGRES_URL` is unset (`describeOrSkip`). Zero real DB coverage for FUP-02/FUP-05 since that commit.

## Solution

In `insertLead()`:
1. Drop `brain_type` from the `INSERT`/`SET` clauses — `leads` doesn't have or need that column.
2. Give each test lead a unique `numero` (e.g. derive from `leadId`) and change the `ON CONFLICT` target to `numero` (the column that actually has a unique constraint) — or add a migration-backed unique index on `unique_id` if per-lead upsert-by-unique_id is the real intent.

See `33-REVIEW.md` CR-01/CR-02 for full detail and a suggested patch.
