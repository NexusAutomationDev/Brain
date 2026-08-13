---
phase: 33-seed-por-tipo-de-brain
reviewed: 2026-08-13T16:58:25Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/core/src/__tests__/integration/fup-e2e.test.ts
  - packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts
  - packages/core/src/fup/fup-scheduler.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/__tests__/runner-fup.test.ts
  - packages/core/src/runner/__tests__/runner-wr.test.ts
  - packages/core/src/runner/runner.ts
  - packages/database/src/__tests__/integration/seed-idempotency.test.ts
  - packages/database/src/__tests__/unit/seed-cross-brain-isolation.test.ts
  - packages/database/src/__tests__/unit/seed.test.ts
  - packages/database/src/index.ts
  - packages/database/src/seed.ts
  - packages/database/src/seeds/echo/0001_fup_defaults.sql
  - packages/database/src/seeds/sdr/0001_fup_defaults.sql
  - packages/database/src/seeds/support/0001_fup_defaults.sql
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 33: Code Review Report

**Reviewed:** 2026-08-13T16:58:25Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the per-brain-type seed mechanism (`runBrainSeed`, the three `seeds/<type>/0001_fup_defaults.sql` files), the `FupScheduler` background job, and `BrainRunner`'s wiring of seeding/FUP/embeddings into `init()`/`run()`, along with their unit and integration tests.

The seed mechanism itself (`packages/database/src/seed.ts`) is solid: idempotent (`ON CONFLICT DO NOTHING`), lock-protected (`FOR UPDATE NOWAIT` inside `sql.begin()`, mirroring `runMigrations()`), throw-not-exit, and fail-fast validated against the `brainType` it was called with. The three seed SQL files are correctly isolated per brain type (confirmed against the real `leads`/`fup_config`/`prompts` schema — no cross-brain-type literal leakage), and `FupScheduler`'s core state machine (retry, last-step deactivation, failure-count escalation, EVT-03 publish) is well covered by its unit tests.

However, cross-checking `fup-e2e.test.ts` against the actual Drizzle schema/migrations for `leads` turned up two **BLOCKER**-level defects that make the integration test non-functional against a real database (the exact scenario it exists to cover), plus a few design/robustness gaps in the seed↔scheduler interaction introduced by defaulting `fup_config.enabled = true` for every brain type.

## Critical Issues

### CR-01: `fup-e2e.test.ts` inserts a `leads.brain_type` column that does not exist

**File:** `packages/core/src/__tests__/integration/fup-e2e.test.ts:99-124`
**Issue:** `insertLead()` runs:
```sql
INSERT INTO leads (unique_id, nome, numero, brain_type, fup_enabled, ia_ativada, fup_step, fup_next_at)
VALUES (${uniqueId}, 'E2E Test Lead', ${LEAD_NUMERO}, ${BRAIN_TYPE}, ...)
```
The `leads` table (see `packages/database/src/schema/tables.ts:77-110` and every migration under `packages/database/src/migrations/*.sql`, including `0004_even_rick_jones.sql`, `0006_leads_cols_remove_users.sql`, `0007_v1_4_foundation.sql`, `0008_fup_failure_count.sql`) never gets a `brain_type` column. `LeadService.upsertLead()` (`packages/core/src/leads/lead-service.ts`) also never writes such a column — brain-type scoping for `leads` doesn't exist at the schema level (the architecture assumes one DB per Brain type). Running this test against any real PostgreSQL instance (i.e. whenever `DATABASE_URL` is set — the exact condition that flips `RUN_FUP`/`describeOrSkip` on) will fail in `beforeAll()`/each test's `insertLead()` call with `column "brain_type" of relation "leads" does not exist`, so Tests A/B/C never actually exercise FUP-02/FUP-05 as intended. Currently this only "passes" by silently skipping everywhere `DATABASE_URL` is unset.
**Fix:** Drop `brain_type` from the `INSERT`/`ON CONFLICT ... SET` clauses in `insertLead()` — the `leads` table has no such column and doesn't need one (brain-type scoping happens via `fup_config`/`prompts`/seed folder, not per-lead).
```ts
await sql!`
  INSERT INTO leads (unique_id, nome, numero, fup_enabled, ia_ativada, fup_step, fup_next_at)
  VALUES (${uniqueId}, 'E2E Test Lead', ${LEAD_NUMERO}, ${fupEnabled}, ${iaAtivada}, ${fupStep}, NOW() - INTERVAL '1 minute')
  ON CONFLICT (unique_id) DO UPDATE SET ...
`;
```
(see CR-02 below — the `ON CONFLICT (unique_id)` target also needs fixing).

### CR-02: `fup-e2e.test.ts` uses `ON CONFLICT (unique_id)` but `leads.unique_id` has no unique/exclusion constraint — and reuses the same `numero` across independent test leads

**File:** `packages/core/src/__tests__/integration/fup-e2e.test.ts:99-124`
**Issue:** Both `INSERT` branches in `insertLead()` end with `ON CONFLICT (unique_id) DO UPDATE SET ...`. The only unique constraints on `leads` are the primary key (`id`) and `leads_numero_unique_idx` on `numero` (`packages/database/src/migrations/0004_even_rick_jones.sql:13`). `unique_id` (`packages/database/src/schema/tables.ts:81`) is declared `.notNull()` only — no unique index, no PK. Postgres requires the `ON CONFLICT` target to match an existing unique or exclusion constraint; against a real database this raises `there is no unique or exclusion constraint matching the ON CONFLICT specification`, independent of and in addition to CR-01.
Compounding this: all three tests (`Step 0 → Step 1`, `último step`, `_tick() não processa lead desativado`) call `insertLead()` with different `leadId`s but the **same** hardcoded `LEAD_NUMERO = "5511000000001"` (lines 40, 100-124). Since `numero` *does* have a real unique constraint and the `ON CONFLICT` target is `unique_id` (not `numero`), the second and third test's `INSERT` would additionally violate `leads_numero_unique_idx` (duplicate key) even if CR-01/the `ON CONFLICT` target were fixed to something valid.
**Fix:** Either add a real per-test unique `numero` (e.g. derive it from `leadId`) and change the upsert target to a column that is actually unique-constrained, or add a migration-backed unique index on `unique_id` if the intent is genuinely to upsert by lead:
```ts
const numero = `551100000${suffix.padEnd(4, "0")}`; // unique per test
...
ON CONFLICT (numero) DO UPDATE SET ...
```
Whichever column becomes the `ON CONFLICT` target must have a real unique constraint before this test can run against Postgres.

## Warnings

### WR-01: Seeding `fup_config.enabled = true` by default for every brain type auto-arms FUP even when `FUP_WEBHOOK_URL` is unset

**File:** `packages/database/src/seeds/sdr/0001_fup_defaults.sql:13-23`, `packages/database/src/seeds/echo/0001_fup_defaults.sql:13-23`, `packages/database/src/seeds/support/0001_fup_defaults.sql:13-23`, `packages/core/src/leads/lead-service.ts:70-83`, `packages/core/src/runner/runner.ts:239-264`
**Issue:** `runBrainSeed()` is now mandatory in `BrainRunner.init()` (`runner.ts:163-167`) and inserts `fup_config(enabled=true, ...)` for every brain type via these seed files. `LeadService.upsertLead()`/`resetFup()` read that config and, whenever `enabled === true` and `intervalsSeconds.length > 0`, unconditionally set `fup_enabled = true` and compute a real `fup_next_at` for every new/responding lead — regardless of whether the deployment has `FUP_WEBHOOK_URL` configured. `FupScheduler` is only constructed/started in `runner.ts` when `FUP_WEBHOOK_URL` is set (`fupWebhookUrl && this.checkpointer`). So a deployment that never sets `FUP_WEBHOOK_URL` (e.g. an operator who hasn't opted into FUP yet) will still silently accumulate leads with `fup_enabled=true` and increasingly stale `fup_next_at` timestamps that are never processed by anything — misleading anyone reading `leads.fup_enabled`/`fup_next_at` directly, and creating a backlog that "fires all at once" the moment `FUP_WEBHOOK_URL` is later configured (since `fup_next_at` will already be far in the past).
**Fix:** Either gate the seed's `fup_config.enabled` default on whether `FUP_WEBHOOK_URL` is present at seed time, or (simpler) have `LeadService` treat "no `FUP_WEBHOOK_URL`" as "FUP effectively disabled" — e.g. pass a `fupWebhookConfigured: boolean` flag from `BrainRunner` into `LeadService`/`resetFup`, and skip arming `fup_enabled`/`fup_next_at` when it's false, regardless of what `fup_config.enabled` says.

### WR-02: `FupScheduler`'s eligibility query has no per-lead brain-type scoping — relies entirely on the "one DB per Brain type" convention

**File:** `packages/core/src/fup/fup-scheduler.ts:97-124`
**Issue:** The eligibility `SELECT` joins `leads l` to `fup_config fc` via `ON fc.brain_type = ${this.opts.brainType}` — a constant condition, not a join key against any column on `l` (because `leads` has no `brain_type` column at all — see CR-01). This means the query is correct *only* under the documented "1 banco por cliente / 1 Brain type per database" architecture. If that invariant is ever violated (e.g. two Brain images intentionally or accidentally pointed at the same `DATABASE_URL`), each Brain's `FupScheduler` would happily pick up **every** lead in the table — including leads created by a different Brain type — and send FUP messages using its own `fup_config`/prompt, with no isolation whatsoever. This directly undermines the cross-brain isolation goal this phase otherwise tests thoroughly at the seed level (`seed-cross-brain-isolation.test.ts`); there's no equivalent runtime guard for the one place (`leads`) that isn't scoped by `brain_type`.
**Fix:** At minimum, document this trust boundary explicitly next to the query (a single comment referencing the architectural constraint), and/or add a defensive assertion at `BrainRunner.init()` time that no other `brain_type`'s data exists in `fup_config`/`prompts` for this DB, to fail fast if the single-brain-per-DB invariant is ever violated.

### WR-03: `FupScheduler` has no re-entrancy guard against overlapping `_tick()` runs

**File:** `packages/core/src/fup/fup-scheduler.ts:60-72`
**Issue:** `start()` schedules `_tick()` via plain `setInterval(..., FUP_POLL_INTERVAL_MS)`. `setInterval` does not wait for the previous callback's promise to settle before firing again. `_tick()` processes up to `BATCH_SIZE` (10) leads sequentially, and each lead's `_processFupForLead()` can itself take up to `MAX_FUP_ATTEMPTS - 1` (2) retry delays of 1s plus 3 LLM calls plus a webhook POST (up to 5s timeout each) on the failure path — comfortably exceeding the default `FUP_POLL_INTERVAL_MS` (30000ms) under a bad LLM/webhook day. When that happens, a second `_tick()` fires while the first is still running; both call `sql.begin()` independently, so they won't double-process the *same* leads (the Tx1 `SKIP LOCKED` + processing-lock UPDATE prevents that), but they can each pull a fresh batch of up to 10 more leads, so instance-level concurrency (open transactions, concurrent LLM/webhook calls) grows unboundedly the longer failures persist, with no cap.
**Fix:** Guard `_tick()` with a simple in-flight flag (e.g. `if (this._ticking) return; this._ticking = true; try { ... } finally { this._ticking = false; }`) so overlapping intervals become no-ops instead of stacking concurrent batches.

## Info

### IN-01: Dead branch in production — `else if (fupWebhookUrl && !this.checkpointer)` in `runner.ts`

**File:** `packages/core/src/runner/runner.ts:257-264`
**Issue:** `this.checkpointer` is unconditionally assigned in `_compileGraph()` (`runner.ts:590`), which runs synchronously before this check (`runner.ts:225`). The only way to reach the `!this.checkpointer` branch in a real deployment is if `createCheckpointer()` resolves to a falsy value without throwing — the WR-01 unit tests exercise this exclusively via a test-only mock override (`mockCreateCheckpointer.mockImplementationOnce(async () => null)`). Not wrong, just worth a one-line comment noting this path is effectively test-only today, so a future reader doesn't assume it's a commonly-hit production branch.
**Fix:** Add a short comment: `// Reachable in production only if createCheckpointer() itself returns a falsy value without throwing; covered here defensively / exercised by WR-01 tests via mock injection.`

### IN-02: Magic numbers without named constants in `fup-scheduler.ts`

**File:** `packages/core/src/fup/fup-scheduler.ts:265, 305, 332`
**Issue:** The 1000ms inter-attempt retry delay (`setTimeout(r, 1000)`), the 10-message context window (`messages.slice(-10)`), and the 5000ms webhook timeout (`AbortSignal.timeout(5000)`) are inline literals, while sibling values in the same file (`BATCH_SIZE`, `MAX_FUP_ATTEMPTS`, `MAX_FUP_FAILURES`, `FUP_PROCESSING_LOCK_MINUTES`) are already named module constants. Inconsistent — makes it easy to miss one of these values when tuning behavior later.
**Fix:** Promote to named constants, e.g. `const FUP_RETRY_DELAY_MS = 1000;`, `const FUP_CONTEXT_WINDOW = 10;`, `const FUP_WEBHOOK_TIMEOUT_MS = 5000;`.

### IN-03: `runBrainSeed()` trusts `seedsFolder` to match `brainType` with no cross-check beyond post-hoc validation

**File:** `packages/database/src/seed.ts:38-52`
**Issue:** `runBrainSeed(sql, brainType, seedsFolder)` executes every `.sql` file found under `seedsFolder` unconditionally, and only afterward validates that rows exist *for the given `brainType`*. This is a reasonable fail-fast net (confirmed correct by `seed.test.ts`), but if `seedsFolder` were ever pointed at the parent `seeds/` directory (containing only subdirectories, no `.sql` files at that level) instead of `seeds/<type>/`, `readdir()` + `.filter(name => name.endsWith('.sql'))` silently produces an empty file list — no error until the later `fup_config`/`prompts` validation throws. The resulting error message doesn't hint that the folder itself might be wrong (parent vs. leaf directory), only that rows are missing for `brainType`.
**Fix:** Nice-to-have: when `sqlFileNames.length === 0`, throw immediately with a clearer message (e.g. `` `[seed] Nenhum arquivo .sql encontrado em ${seedsFolder} — confirme que SEEDS_FOLDER aponta para seeds/<brainType>, não para o diretório pai.` ``) instead of falling through to the generic post-seed validation error.

---

_Reviewed: 2026-08-13T16:58:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
