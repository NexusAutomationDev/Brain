---
phase: 34-funda-o-de-handoff-agents-dblink
plan: 01
subsystem: database
tags: [drizzle, postgres, dblink, migrations, schema]

# Dependency graph
requires:
  - phase: 33-seed-por-tipo-de-brain
    provides: runMigrations()/_schema_lock mechanism (unmodified, reused as-is)
provides:
  - "agents pgTable (name PK, brain_type, connection_string, enabled, timestamps) — the Brain destination registry for lead handoff"
  - "leads.handoff_context nullable text column — populated/consumed by Phase 35's transfer_lead tool"
  - "CREATE EXTENSION IF NOT EXISTS dblink bootstrapped automatically inside shared migration 0012"
  - "Real-Postgres-verified proof that migration 0012 applies cleanly end-to-end via the project's own runMigrations() mechanism"
affects: [35-execu-o-de-handoff-transfer-lead]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Text-PK table idiom (fupConfig precedent) reused for agents.name"
    - "Extension bootstrap inside a versioned migration file (CREATE EXTENSION IF NOT EXISTS dblink), contrasted with migrate.ts's separate pre-transaction vector bootstrap"

key-files:
  created:
    - packages/database/src/migrations/0012_agents_dblink_handoff_context.sql
    - packages/database/src/migrations/meta/0012_snapshot.json
  modified:
    - packages/database/src/schema/tables.ts
    - packages/database/src/migrations/meta/_journal.json

key-decisions:
  - "Task 1 checkpoint (D-01/D-04, agents table shape + shared-migration placement) resolved by user: option-a — proceed with the researched shape exactly as specified"
  - "Regenerated migration 0012 with EMBEDDING_DIMENSIONS=3072 exported at drizzle-kit generate time to avoid the documented DEV-WORKFLOW GOTCHA (migration 0011's own inline warning) — the default EMBEDDING_DIMENSIONS=1536 produced a spurious diff reverting embeddings/knowledge_chunks from halfvec(3072) back to vector(1536) and dropping/recreating the HNSW index; discarded that first generation and regenerated clean, keeping migration 0012 scoped to exactly agents + dblink + leads.handoff_context per the plan's acceptance criteria"

patterns-established:
  - "Shared, cross-Brain-type schema (agents/dblink/handoff_context) lives in the normal Drizzle migrations/ folder applied by runMigrations(), NOT in the Phase 33 per-brain-type seed mechanism — reserved for genuinely brain-type-scoped content"

requirements-completed: [HANDOFF-01, HANDOFF-02]

coverage:
  - id: D1
    description: "agents pgTable with name (PK), brain_type, connection_string, enabled (default true), created_at/updated_at — populable via direct SQL, no redeploy needed"
    requirement: "HANDOFF-01"
    verification:
      - kind: integration
        ref: "psql \"$DATABASE_URL\" -c '\\d agents' against a real freshly-provisioned Postgres 17 instance — confirmed all six columns present"
        status: pass
    human_judgment: false
  - id: D2
    description: "CREATE EXTENSION IF NOT EXISTS dblink runs automatically as part of the shared migration 0012 during runMigrations() — no manual per-database activation needed"
    requirement: "HANDOFF-02"
    verification:
      - kind: integration
        ref: "psql \"$DATABASE_URL\" -c \"SELECT extname FROM pg_extension WHERE extname='dblink';\" — exactly one row returned after bun src/migrate.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "leads.handoff_context nullable text column present in schema and migration, no data written/read yet (deferred to Phase 35)"
    verification:
      - kind: integration
        ref: "psql \"$DATABASE_URL\" -c '\\d leads' — handoff_context column confirmed present, nullable"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full migration chain (0000-0012) applies cleanly end-to-end via the project's own bun src/migrate.ts mechanism against a real, from-scratch Postgres 17 instance; re-run is idempotent"
    verification:
      - kind: integration
        ref: "bun src/migrate.ts — exit code 0, 'Migrations completed successfully'; second run only emits already-exists NOTICEs, no re-application"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-14
status: complete
---

# Phase 34 Plan 01: Fundação de Handoff (Agents + DBLink) Summary

**agents pgTable (destination registry) + leads.handoff_context column + `CREATE EXTENSION IF NOT EXISTS dblink` bundled into one new shared migration 0012, applied and psql-verified against a real, freshly-provisioned Postgres 17 instance**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-14T01:10:37Z
- **Tasks:** 2 (Task 1 checkpoint:decision resolved by user before this dispatch; Task 2 tracer fully executed)
- **Files modified:** 4

## Accomplishments
- New `agents` pgTable in `tables.ts`: `name` (text PK), `brain_type` (text, not null), `connection_string` (text, not null, libpq key=value format per D-02), `enabled` (boolean, default true), `created_at`/`updated_at` (timestamps) — exact shape confirmed by the D-01/D-04 checkpoint decision
- New nullable `leads.handoff_context` column added to the existing `leads` pgTable — no new table, no `.notNull()`
- New shared migration `0012_agents_dblink_handoff_context.sql` bundling `CREATE EXTENSION IF NOT EXISTS dblink` + `CREATE TABLE "agents"` + `ALTER TABLE "leads" ADD COLUMN "handoff_context"` in that exact order, applied by the existing, unmodified `runMigrations()`/`_schema_lock` mechanism
- Full migration chain (0000 through the new 0012) applied end-to-end against a real, freshly-provisioned Postgres 17 scratch instance via `bun src/migrate.ts` (exit code 0), and confirmed via direct `psql` inspection — not type-checked, not mocked
- Re-running `bun src/migrate.ts` against the same database confirmed idempotent (only "already exists, skipping" NOTICEs, migration 0012 not reapplied)
- Scratch container torn down after verification — `docker ps -a` shows no residual `brain-phase34-test-pg`

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm agents table shape + shared-migration placement (checkpoint:decision)** - resolved by user (option-a) prior to this dispatch, per orchestrator instructions — no code commit for this task (decision-only)
2. **Task 2: agents table + leads.handoff_context column + dblink extension — migration 0012** - `4d57f34` (feat)

_Note: this plan has no separate plan-metadata commit beyond the STATE/ROADMAP update below, since Task 1 produced no file changes._

## Files Created/Modified
- `packages/database/src/schema/tables.ts` - new `agents` export + `leads.handoffContext` nullable column
- `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql` - new migration: dblink extension + agents table + handoff_context column
- `packages/database/src/migrations/meta/_journal.json` - new idx=12 entry for `0012_agents_dblink_handoff_context`
- `packages/database/src/migrations/meta/0012_snapshot.json` - new, auto-generated by `drizzle-kit generate`

## Decisions Made
- None — Task 1 checkpoint resolved by user: option-a, proceeding with researched schema exactly as specified (agents table shape D-01, shared-migration placement D-04)
- Regenerated migration 0012 with `EMBEDDING_DIMENSIONS=3072` exported at generate-time (matching the actual production schema state left by migration 0011) to avoid the spurious `embeddings`/`knowledge_chunks` vector-type revert diff that the default `EMBEDDING_DIMENSIONS=1536` would have introduced — this gotcha is explicitly documented inline in migration 0011's own header comment (D-16 tech debt, PROJECT.md)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Discarded a spurious drizzle-kit diff before hand-editing migration 0012**
- **Found during:** Task 2 (first `drizzle-kit generate` invocation)
- **Issue:** Running `bunx drizzle-kit generate --name agents_dblink_handoff_context` with the default `EMBEDDING_DIMENSIONS` (unset, defaults to 1536) produced a migration file that, in addition to the intended `agents`/`handoff_context` DDL, also contained `DROP INDEX "embeddings_embedding_idx"`, `ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(1536)`, and the equivalent for `knowledge_chunks` — a destructive, unrelated schema revert. This is the exact "DEV-WORKFLOW GOTCHA" migration 0011 itself warns about inline: the production schema's actual embedding column type is `halfvec(3072)` (set by migration 0011, generated with `EMBEDDING_DIMENSIONS=3072`), and any future default-dimension `generate` run treats that as a diff to revert.
- **Fix:** Deleted the first-generated `0012_agents_dblink_handoff_context.sql`/`0012_snapshot.json` and reverted the journal's idx=12 entry, then re-ran `bunx drizzle-kit generate --name agents_dblink_handoff_context` with `EMBEDDING_DIMENSIONS=3072` exported alongside `DATABASE_URL`, producing a clean diff scoped to exactly `agents` + `leads.handoff_context` — matching the plan's acceptance criteria and RESEARCH.md's Pattern 1 code example verbatim.
- **Files modified:** `packages/database/src/migrations/0012_agents_dblink_handoff_context.sql`, `packages/database/src/migrations/meta/_journal.json`, `packages/database/src/migrations/meta/0012_snapshot.json`
- **Verification:** Confirmed via `psql` that `embeddings`/`knowledge_chunks.embedding` remained `halfvec(3072)` (untouched) after the full migration chain applied; the final migration 0012 file contains only the three expected statements in order
- **Committed in:** `4d57f34` (Task 2 commit — the corrected file was the only one ever staged/committed)

---

**Total deviations:** 1 auto-fixed (1 bug — spurious pre-existing dev-workflow gotcha avoided, not a new bug introduced by this plan)
**Impact on plan:** Necessary to keep migration 0012 scoped exactly to HANDOFF-01/02 per the plan's acceptance criteria; no scope creep, no unrelated schema change shipped.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required. `dblink` is a native PostgreSQL contrib extension already bundled in the project's `pgvector/pgvector:pg17` Docker image; no npm/pip/cargo package involved.

## Next Phase Readiness
- `agents` table + `leads.handoff_context` + `dblink` extension are now part of the standard migration chain — will apply automatically to every existing and future Brain database via `BrainRunner.init()` → `runMigrations()`, no code changes needed in `runner.ts`
- Plan 34-02 can now build `getAgentConnection(sql, name)` directly against this schema
- Phase 35 can build `transfer_lead` and the actual `dblink_exec` write path on top of this foundation

---
*Phase: 34-funda-o-de-handoff-agents-dblink*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: packages/database/src/schema/tables.ts (contains `export const agents = pgTable('agents'` and `handoffContext: text('handoff_context'),`)
- FOUND: packages/database/src/migrations/0012_agents_dblink_handoff_context.sql
- FOUND: packages/database/src/migrations/meta/0012_snapshot.json
- FOUND: packages/database/src/migrations/meta/_journal.json entry idx=12, tag "0012_agents_dblink_handoff_context"
- FOUND: commit 4d57f34 in `git log --oneline --all`
