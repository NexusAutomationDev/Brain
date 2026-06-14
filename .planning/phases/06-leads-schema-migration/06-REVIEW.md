---
phase: 06-leads-schema-migration
reviewed: 2026-06-14T01:41:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - apps/brain-echo/src/index.ts
  - packages/core/src/runner/runner.ts
  - packages/database/src/migrate.ts
  - packages/database/src/migrations/0004_even_rick_jones.sql
  - packages/database/src/migrations/meta/0004_snapshot.json
  - packages/database/src/migrations/meta/_journal.json
  - packages/database/src/schema/tables.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-06-14T01:41:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

This phase introduces the `leads` table (schema + migration 0004) and wires it into the runner and entry point. The migration itself is structurally correct and the advisory-lock pattern for multi-instance safety is well-executed. The main risks are: (1) `unique_id` has no uniqueness constraint despite being the field used as LangGraph `thread_id`, opening the door to collisions; (2) `updated_at` is `DEFAULT now()` only — no trigger or ORM-level enforcement means updates silently leave the column stale; (3) the `threadId` is currently `event.Numero` (not `lead.unique_id`), creating an intentional but undocumented mismatch between the field that carries the LangGraph state key and the one that will eventually replace it; (4) `migrate.ts` uses bare `console.log` instead of the project's structured Pino logger, creating an inconsistent observability surface.

## Warnings

### WR-01: `unique_id` has no UNIQUE constraint — collisions possible as thread_id

**File:** `packages/database/src/schema/tables.ts:85` / `packages/database/src/migrations/0004_even_rick_jones.sql:3`

**Issue:** `unique_id` is defined as `NOT NULL` but has no `UNIQUE` constraint in the schema or the migration. According to the architecture, this field is the `IDLead` from the integration payload and will become the `thread_id` for LangGraph's PostgresSaver (runner.ts line 150 comment). If two leads are created with the same `IDLead` (duplicate CRM entry, retry with same ID) no database-level guard prevents it, and both would share — or corrupt — the same LangGraph checkpoint history.

**Fix:** Add a unique index on `unique_id` in both schema and migration:

```typescript
// packages/database/src/schema/tables.ts
}, (table) => ({
  numeroIdx: uniqueIndex('leads_numero_unique_idx').on(table.numero),
  uniqueIdIdx: uniqueIndex('leads_unique_id_idx').on(table.uniqueId), // ADD THIS
}));
```

```sql
-- in 0004_even_rick_jones.sql (or a new 0005 migration)
CREATE UNIQUE INDEX "leads_unique_id_idx" ON "leads" USING btree ("unique_id");
```

---

### WR-02: `updated_at` is never updated on row writes — stale timestamps guaranteed

**File:** `packages/database/src/schema/tables.ts:96` / `packages/database/src/migrations/0004_even_rick_jones.sql:9`

**Issue:** `updated_at` defaults to `now()` at insert time, but there is no `ON UPDATE` trigger and no ORM hook to set it on `UPDATE`. Every upsert operation (Phase 7 `LeadService.upsert`) will leave `updated_at` frozen at insert time regardless of how many times the row is updated. This is a latent correctness bug: `updated_at` exists for observability/debugging purposes and will silently mislead anyone querying it.

The same issue exists on `users`, `memories`, `agent_state`, and `prompts` tables (inherited from earlier migrations), but those are out of scope for this phase.

**Fix (recommended — PostgreSQL trigger):** Add a trigger in the migration:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Fix (acceptable — ORM-level):** Ensure every `db.update(leads).set({ ..., updatedAt: new Date() })` call is enforced in `LeadService` when it is implemented in Phase 7.

---

### WR-03: `threadId = event.Numero` will be wrong once LeadService is introduced

**File:** `packages/core/src/runner/runner.ts:151`

**Issue:** Line 151 assigns `threadId = event.Numero` with a comment marking it as temporary ("Phase 8: substituir por `lead.unique_id`"). The problem is that `event.Numero` (phone number) and `lead.unique_id` (IDLead from CRM) are semantically different: one lead can change phone numbers, and one phone number could theoretically map to multiple CRM IDs over time. Using `Numero` now means the entire LangGraph checkpoint history is keyed by phone number. When Phase 8 switches to `unique_id`, **all existing checkpoint data becomes orphaned** — the new key will find no prior state in PostgresSaver.

This is a data migration risk, not just a code change. The mismatch is acknowledged in the comment but the risk of orphaned checkpoint rows is not documented.

**Fix:** Either:
1. Accept the orphan risk, document it explicitly, and plan a data migration script in Phase 8 to re-key existing checkpoint rows (`UPDATE checkpoints SET thread_id = new_id WHERE thread_id = old_numero`).
2. Or, if LeadService can be introduced before Phase 8, use `lead.unique_id` as `threadId` from the moment leads are persisted (Phase 7), avoiding the orphan problem entirely.

At minimum, add a comment here noting that checkpoint rows keyed by `Numero` will be orphaned when switching to `unique_id`.

---

### WR-04: Advisory lock not released if `pg_advisory_lock` itself throws

**File:** `packages/database/src/migrate.ts:17-26`

**Issue:** The `try/finally` block (lines 19-27) correctly releases the lock after migration, but the `await sql\`SELECT pg_advisory_lock(...)\`` call on line 17 is **outside** the `try` block. If the lock acquisition itself throws (e.g., the connection drops mid-acquire), the `finally` block does not run. In practice PostgreSQL will automatically release session-level advisory locks when the connection closes, so this is not a permanent deadlock risk — but it is a correctness gap: the error from line 17 propagates unwrapped and does not log a clear diagnostic.

**Fix:** Wrap the lock acquisition inside the try, or at minimum catch and re-throw with a clearer message:

```typescript
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  console.log('[migrate] Aguardando advisory lock para migrations...');
  try {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    console.log('[migrate] Advisory lock adquirido — iniciando migrations');
    const db = drizzle(sql);
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migrations concluídas com sucesso');
  } finally {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    console.log('[migrate] Advisory lock liberado');
  }
}
```

## Info

### IN-01: `migrate.ts` uses `console.log` instead of the project's Pino logger

**File:** `packages/database/src/migrate.ts:16-26`

**Issue:** All log statements in `runMigrations` use `console.log`/`console.error`. The project's stack defines Pino (`@brain-pkg/observability`) as the structured logger throughout. `runner.ts` uses `createLogger()` for all its statements. Migration output is invisible to log aggregators that parse JSON lines, and cannot carry structured fields like `brainId` or `migrationsFolder`.

**Fix:** Import `createLogger` from `@brain-pkg/observability` and replace `console.log` calls. For the CLI code path (`import.meta.main`), `console` is acceptable as a fallback since that path runs outside the app lifecycle.

---

### IN-02: `threadId` / `sessionId` / `userId` semantic overlap in `run()`

**File:** `packages/core/src/runner/runner.ts:151-172`

**Issue:** Within a single `run()` call, `threadId = event.Numero` is used as both `sessionId` and as `configurable.thread_id`, while `event.IDLead` is used as `userId`. These two fields carry different semantics (`Numero` = phone, `IDLead` = CRM id) but are used in three different roles (LangGraph thread, tracing session, memory user). When Phase 8 changes `threadId` to `lead.unique_id`, callers of `memoryManager.getContext` and `compiledGraph.invoke` will receive a different value for `sessionId` without an obvious code change — the rename is implicit. This is worth documenting explicitly now.

**Fix:** Add a brief comment block grouping the intent:

```typescript
// threadId: LangGraph checkpoint key. Currently event.Numero (Phase 8: switch to lead.unique_id).
// userId: CRM identity for memory storage. Remains event.IDLead permanently.
const threadId = event.Numero;
const userId = event.IDLead;
```

---

### IN-03: Snapshot `0004_snapshot.json` has no `unique_id` uniqueness entry, confirming WR-01

**File:** `packages/database/src/migrations/meta/0004_snapshot.json:161-240`

**Issue:** The `public.leads` table entry in the snapshot shows only one index (`leads_numero_unique_idx`) and no `uniqueConstraints` for `unique_id`. This confirms WR-01 is a real gap in both the migration SQL and the Drizzle snapshot, not just an oversight in `tables.ts`. Both must be updated together to remain in sync.

**Fix:** See WR-01 fix. After adding the uniqueIndex in `tables.ts`, regenerate the snapshot with `bun drizzle-kit generate` to keep meta files consistent.

---

_Reviewed: 2026-06-14T01:41:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
