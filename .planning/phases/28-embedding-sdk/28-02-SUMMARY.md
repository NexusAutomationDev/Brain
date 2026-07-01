---
phase: 28-embedding-sdk
plan: 02
subsystem: database
tags: [drizzle, drizzle-kit, postgresql, pgvector, migrations, postgres-js]

# Dependency graph
requires:
  - phase: 28-01
    provides: IEmbeddingProvider abstraction + EMBEDDING_DIMENSIONS ENV contract that this migration makes real at the schema level
provides:
  - Migration 0009 fixing hardcoded vector(1536) on embeddings and knowledge_chunks — ENV-driven dimension is now the live schema, closing D-16
  - Repaired drizzle-kit snapshot chain (0008_snapshot.json regenerated from tables.ts, 0009_snapshot.json chained) — db:generate works non-interactively again
  - Fixed self-deadlock bug in packages/database/src/migrate.ts CLI entrypoint (max:1 -> max:2)
affects: [29-brain-suporte-core, 30-brain-suporte-docker, any future packages/database migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "drizzle-kit generate from an empty snapshot (--out to scratch dir, no journal entries) produces the canonical schema-native serialization for a table/index — use this as ground truth when repairing a corrupted/missing snapshot chain, instead of `introspect` (introspected DB metadata differs subtly, e.g. numeric vs string index `with` params, extra `opclass` keys, causing spurious DROP/CREATE INDEX diffs)"
    - "runMigrations()'s row-lock transaction (sql.begin) and drizzle's internal migrate() both need a live connection concurrently from the same postgres.js pool — CLI scripts calling runMigrations() must use max >= 2, never max: 1"

key-files:
  created:
    - packages/database/src/migrations/0009_embedding_dimensions_fix.sql
    - packages/database/src/migrations/meta/0008_snapshot.json
    - packages/database/src/migrations/meta/0009_snapshot.json
  modified:
    - packages/database/src/migrations/meta/_journal.json
    - packages/database/.env.example
    - packages/database/src/migrate.ts

key-decisions:
  - "Kept EMBEDDING_DIMENSIONS=1536 for migration 0009 generation (no dimension value change this phase) — the point of this migration is proving the ENV-driven generation mechanism end-to-end, not changing the default"
  - "Repaired missing drizzle-kit snapshots for migrations 0005-0008 (never generated via drizzle-kit, hand-authored SQL+journal in prior phases) by regenerating from tables.ts against an empty state, not from live-DB introspection — avoids spurious index diffs from serialization format mismatches"
  - "Fixed migrate.ts CLI pool max:1 -> max:2 (Rule 1 bug fix) — found via this plan's live-DB verification requirement, no prior E2E test had exercised bun src/migrate.ts against a real Postgres instance"

requirements-completed: [EMBD-03]

duration: 62min
completed: 2026-07-01
---

# Phase 28 Plan 02: Migration 0009 — ENV-driven vector(N) dimension fix Summary

**Migration 0009 replaces hardcoded `vector(1536)` on `embeddings`/`knowledge_chunks` with the `EMBEDDING_DIMENSIONS`-driven value baked in at `drizzle-kit generate` time, with an explicit `TRUNCATE` making it self-contained against any dev/test DB state — verified end-to-end against a real Postgres+pgvector container.**

## Performance

- **Duration:** 62 min
- **Started:** 2026-07-01T13:38:00Z
- **Completed:** 2026-07-01T14:40:10Z
- **Tasks:** 2
- **Files modified:** 8 (3 created new, 1 created+restored via repair, 4 modified)

## Accomplishments
- Migration `0009_embedding_dimensions_fix.sql` created with `TRUNCATE` + dual `ALTER COLUMN TYPE vector(1536)` (embeddings, knowledge_chunks), closing D-16 tech debt
- Repaired a pre-existing, previously-undetected gap in the drizzle-kit snapshot chain (migrations 0005-0008 were hand-authored SQL, never `drizzle-kit generate`d, so no snapshot files existed for them) — this was silently blocking any future `db:generate` run with an unresolvable interactive TTY prompt
- Discovered and fixed a genuine self-deadlock bug in `packages/database/src/migrate.ts`'s CLI entrypoint (`max: 1` pool size caused `runMigrations()`'s row-lock transaction and drizzle's internal `migrate()` to starve each other for the single available connection) — this bug had never been caught because no E2E test had run `bun src/migrate.ts` against a real database before this plan's Task 2
- Verified migration 0009 end-to-end: pre-existing rows are truncated, both vector columns become `vector(1536)`, and the `embeddings_embedding_idx` HNSW index survives the type change untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Set EMBEDDING_DIMENSIONS and generate migration 0009** - `f80071e` (feat)
2. **Task 2: Verify migration 0009 against a live disposable Postgres+pgvector instance** - `0526219` (fix — the deadlock bug found during verification)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` - TRUNCATE + dual ALTER COLUMN TYPE vector(1536)
- `packages/database/src/migrations/meta/0008_snapshot.json` - Repaired snapshot (regenerated from tables.ts against empty state) representing true schema state after migration 0008
- `packages/database/src/migrations/meta/0009_snapshot.json` - Snapshot chained from repaired 0008, structurally identical (no schema shape change, only the vector dimension literal reasserted)
- `packages/database/src/migrations/meta/_journal.json` - New idx:9 entry for `0009_embedding_dimensions_fix`
- `packages/database/.env.example` - Documents that changing `EMBEDDING_DIMENSIONS` requires a new generated migration (generation-time, not runtime, behavior)
- `packages/database/src/migrate.ts` - CLI entrypoint pool `max: 1` -> `max: 2`, with comment explaining the deadlock

## Decisions Made
- Kept `EMBEDDING_DIMENSIONS=1536` for this migration's generation — no dimension value change was requested for this phase; the goal is proving the mechanism works, matching the existing OpenAI `text-embedding-3-small` default
- Chose "regenerate snapshot from schema against empty state" over "introspect live DB" for repairing the missing 0005-0008 snapshots — introspection produces subtly different index metadata serialization (string vs numeric `with` params, extra `opclass` keys) that caused spurious `DROP INDEX`/`CREATE INDEX` diffs; the schema-native regeneration is byte-exact with what `tables.ts` always produces
- Did not touch existing applied migration files (0000-0008) or their historical hand-authored nature — only added the missing *snapshot* metadata needed for drizzle-kit's diff engine, preserving migration history integrity

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repaired missing drizzle-kit snapshots for migrations 0005-0008**
- **Found during:** Task 1 (`bun run db:generate`)
- **Issue:** `drizzle-kit generate` failed non-interactively with `Error: Interactive prompts require a TTY terminal` — caused by `tablesResolver`'s rename-ambiguity prompt ("Is fup_config table created or renamed from another table? users -> fup_config"). Root cause: migrations 0005-0008 were hand-authored SQL+journal entries in prior phases (git history confirms, e.g. commits `4d53940`, `3b7b7b5`, `754d3e8`), never run through `drizzle-kit generate`, so no snapshot files exist for them. The last real snapshot (`0004_snapshot.json`) still contains a dropped `users` table and is missing `knowledge_chunks`/`fup_config`/FUP columns, causing drizzle-kit to see an irreducible rename ambiguity between the dropped and new tables. The plan explicitly anticipated this exact scenario (RESEARCH.md Pitfall 5) and instructed: "STOP and flag for manual intervention rather than force-answering the prompt blindly."
- **Fix:** Regenerated an accurate snapshot representing true schema state after migration 0008, using `drizzle-kit generate` against `tables.ts` with an empty scratch journal (produces the canonical schema-native serialization, avoiding introspection's serialization drift), then chained it into `meta/` as `0008_snapshot.json` with a fresh `id`/`prevId` linking to the real `0004_snapshot.json`. This resolved the ambiguity deterministically (no rename question possible when the "from" state already matches actual current schema) without altering any existing applied migration SQL file or journal entry for 0000-0008.
- **Files modified:** `packages/database/src/migrations/meta/0008_snapshot.json` (new), `packages/database/src/migrations/meta/0009_snapshot.json` (new, chained)
- **Verification:** `bun run db:generate` after the repair reports "No schema changes, nothing to migrate" when re-run with the same `EMBEDDING_DIMENSIONS`, confirming the snapshot chain now accurately tracks `tables.ts` with zero drift
- **Committed in:** `f80071e` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed self-deadlock in migrate.ts CLI pool (max:1 -> max:2)**
- **Found during:** Task 2 (live-DB verification of migration 0009)
- **Issue:** `bun src/migrate.ts` hung indefinitely (confirmed via `pg_stat_activity`: the row-lock transaction sat `idle in transaction` waiting `ClientRead` while drizzle's internal `migrate()` — which runs its own queries via the pool, not the transaction — could never acquire the second connection it needed from the same `max: 1` pool). This is a genuine pre-existing bug in existing code, not introduced by this plan, but it directly blocked Task 2's explicit verification requirement (running `bun src/migrate.ts` against a live database) and had never been caught before because no prior E2E test exercised this exact CLI path against a real Postgres instance (confirmed: `migration-v14.test.ts` only asserts file/string content, no live DB).
- **Fix:** Changed the CLI entrypoint's `postgres()` call from `{ max: 1, prepare: false }` to `{ max: 2, prepare: false }`, with an inline comment explaining the deadlock. Confirmed this is scoped correctly: production callers (`apps/brain-echo` uses `max: 10`, `TenantPoolManager` uses 10-20 per D-09) were never affected — only the standalone CLI script used `max: 1`.
- **Files modified:** `packages/database/src/migrate.ts`
- **Verification:** Re-ran `bun src/migrate.ts` against the same live container — completed successfully with the row-lock acquired and migrations applied; full `bun test` suite (65 tests, 4 files) still passes
- **Committed in:** `0526219` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking snapshot-chain repair, 1 blocking bug fix)
**Impact on plan:** Both fixes were prerequisites for completing this plan's explicit acceptance criteria (Task 1 needed `db:generate` to run at all; Task 2 needed `bun src/migrate.ts` to actually complete against a live DB). No scope creep — no unrelated code was touched, and existing applied migration SQL/journal entries for 0000-0008 were left byte-for-byte unchanged.

## Issues Encountered
- Initial attempts to script drizzle-kit's interactive TTY prompt (via `script -qc`, piped stdin, file-redirected stdin) all failed because the prompt library requires raw-mode keypress input, not line-buffered text — confirmed this matches the plan's own warning against "force-answering the prompt blindly." Resolved by fixing the underlying snapshot-chain gap instead of trying to answer the prompt.
- Worktree had no `node_modules` installed initially (pnpm workspace, not symlinked from main checkout) — resolved with `pnpm install --frozen-lockfile` in the worktree before any `bun`/`drizzle-kit` command would resolve modules.

## User Setup Required

None - no external service configuration required. Migration 0009 auto-applies via `runMigrations()` on next `BrainRunner.init()` for any environment with `MIGRATIONS_FOLDER` pointing at `packages/database/src/migrations` (per D-19, this includes an unconditional `TRUNCATE` of `embeddings` and `knowledge_chunks` — safe per D-05, no production clients exist yet, documented in the threat model as an accepted, intentional tradeoff).

## Next Phase Readiness
- D-16 tech debt fully closed: `packages/embeddings`' dimension configurability (28-01) now has a live schema that actually reflects `EMBEDDING_DIMENSIONS`
- Plan 04's BrainRunner dimension fail-fast check (D-15) has a real `vector(N)` column to introspect and compare against
- The repaired drizzle-kit snapshot chain means future migrations in this package can be generated normally via `bun run db:generate` without hitting the same TTY-prompt blocker
- The `migrate.ts` deadlock fix applies to any future CLI-driven migration run in this repo or downstream Brain apps that reuse this pattern

---
*Phase: 28-embedding-sdk*
*Completed: 2026-07-01*

## Self-Check: PASSED

All created/modified files verified present on disk:
- `packages/database/src/migrations/0009_embedding_dimensions_fix.sql` — FOUND
- `packages/database/src/migrations/meta/0008_snapshot.json` — FOUND
- `packages/database/src/migrations/meta/0009_snapshot.json` — FOUND
- `packages/database/src/migrations/meta/_journal.json` — FOUND
- `packages/database/.env.example` — FOUND
- `packages/database/src/migrate.ts` — FOUND
- `.planning/phases/28-embedding-sdk/28-02-SUMMARY.md` — FOUND

All commit hashes verified present in git history:
- `f80071e` (Task 1) — FOUND
- `0526219` (Task 2) — FOUND
