---
phase: quick-260717-wpk
plan: 01
subsystem: database
tags: [drizzle, pgvector, halfvec, embeddings, gemini, migrations]

requires: []
provides:
  - "packages/database/src/schema/tables.ts conditionally emits halfvec(N)/halfvec_cosine_ops instead of vector(N)/vector_cosine_ops when EMBEDDING_DIMENSIONS > 2000"
  - "Real, drizzle-kit-generated 0011_gemini_highdim_halfvec_3072.sql migration, validated against dev Postgres, registered in the shared migration journal"
affects: [brain-sdr, brain-suporte, apps/*-Dockerfile, database]

tech-stack:
  added: []
  patterns:
    - "Dimension-conditional Drizzle column type (vector vs halfvec) gated on pgvector's 2000-dim HNSW/IVFFlat cap"

key-files:
  created:
    - packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql
    - packages/database/src/migrations/meta/0011_snapshot.json
  modified:
    - packages/database/src/schema/tables.ts
    - packages/database/src/migrations/meta/_journal.json
    - packages/database/src/migrations/0009_embedding_dimensions_fix.sql

key-decisions:
  - "Used halfvec(N) instead of vector(N) for EMBEDDING_DIMENSIONS > 2000 — pgvector rejects HNSW/IVFFlat indexes above 2000 dims for vector, but supports halfvec up to 4000 dims"
  - "Threshold hardcoded to 2000 (pgvector's documented, version-stable cap), not derived from EMBEDDING_DIMENSIONS itself"
  - "NOT merged into master — kept on branch worktree-agent-a51d3dffce5d3b264 deliberately. Reason: 0009's migration is safe (already in master, unchanged), but 0011 applies unconditionally to any tenant sharing whichever image includes it, and apps/brain-sdr/Dockerfile copies the whole migrations/ folder wholesale with no flavor gating yet. Merging to master today would silently put 0011 in the next standard brain-sdr:1.5 build, truncating and converting every existing 1536/OpenAI tenant's embeddings to halfvec(3072) on next boot. Merge only after a build-time exclusion mechanism (separate Dockerfile target/flavor) exists — tracked as required follow-up, not done here (out of scope for this quick task)."
  - "runner.ts's atttypmod-based dimension fail-fast check required NO code change — empirically confirmed halfvec(N) encodes atttypmod identically to vector(N) (N stored directly)"

patterns-established:
  - "EMBEDDING_NEEDS_HALFVEC / EMBEDDING_OP_CLASS ternary pattern for any future embedding-bearing table that needs to support both <=2000 and >2000 dim providers"

requirements-completed: [QUICK-01]

coverage:
  - id: D1
    description: "tables.ts emits halfvec(3072)/halfvec_cosine_ops at EMBEDDING_DIMENSIONS=3072, and unchanged vector(N)/vector_cosine_ops at default/<=2000"
    requirement: "QUICK-01"
    verification:
      - kind: unit
        ref: "packages/database/src/schema/tables.test.ts (38 tests, unmodified, EMBEDDING_DIMENSIONS=128 default env)"
        status: pass
      - kind: other
        ref: "cd packages/database && bun run typecheck && bun run lint && EMBEDDING_DIMENSIONS=3072 bun run typecheck && EMBEDDING_DIMENSIONS=3072 bun run lint"
        status: pass
    human_judgment: false
  - id: D2
    description: "Real drizzle-kit-generated 0011_gemini_highdim_halfvec_3072.sql migration applies cleanly against a database at the real post-0010 (vector(1536)) production schema state, and halfvec(N) atttypmod encoding matches vector(N)"
    requirement: "QUICK-01"
    verification:
      - kind: integration
        ref: "psql BEGIN;...ROLLBACK; against 127.0.0.1:5432/brain_test — TRUNCATE + DROP INDEX + 2x ALTER COLUMN TYPE halfvec(3072) + CREATE INDEX halfvec_cosine_ops applied with zero errors; atttypmod for knowledge_chunks.embedding read back as 3072; post-rollback embeddings.embedding confirmed still vector(1536)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Standard (1536/OpenAI) code path and the already-applied 0009 migration are provably unchanged"
    requirement: "QUICK-01"
    verification:
      - kind: other
        ref: "diff of 0009's TRUNCATE/ALTER statement lines against pre-change baseline (byte-identical); git diff --quiet -- packages/core/src/runner/runner.ts (untouched)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-18
status: complete
---

# Quick Task 260717-wpk: Halfvec support for high-dimension embeddings Summary

**`packages/database/src/schema/tables.ts` now conditionally emits `halfvec(N)`/`halfvec_cosine_ops` instead of `vector(N)`/`vector_cosine_ops` whenever `EMBEDDING_DIMENSIONS` exceeds pgvector's 2000-dim HNSW/IVFFlat cap, and a real, dev-Postgres-validated `0011_gemini_highdim_halfvec_3072.sql` migration now exists for the next Gemini (3072-dim) tenant — held on a separate branch, deliberately not merged to master yet.**

## Performance

- **Duration:** 25 min
- **Tasks:** 3/3 completed (Task 3 was validation-only, no file changes)
- **Files modified:** 5 (1 schema file, 1 existing migration comment, 1 journal, 2 new generated files)

## Merge status — IMPORTANT

This work is **not on master**. It lives on branch `worktree-agent-a51d3dffce5d3b264` (commits `6b75752`, `e9e1c91`), left unmerged on purpose by the orchestrator after execution — see "Operational risk" below.

## Accomplishments

- `embeddings.embedding` and `knowledge_chunks.embedding` columns now pick `halfvec(N)` (pgvector's half-precision type, HNSW-capable up to 4000 dims) when `EMBEDDING_DIM > 2000`, and the existing `vector(N)` otherwise — verified typecheck/lint-clean and test-passing (38/38 unmodified `tables.test.ts` tests) at both the default dimension and `EMBEDDING_DIMENSIONS=3072`.
- Generated and hardened `packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql` via a real `drizzle-kit generate` run against the tracked migration history (idx 0-10), then hand-added the `TRUNCATE` statement and a loud warning header comment (same pattern already used in 0009).
- Validated the exact SQL from 0011 inside a `BEGIN; ... ROLLBACK;` transaction against the local dev Postgres (127.0.0.1:5432/brain_test, currently at the real post-0010 production schema state) — applied with zero errors, then rolled back, leaving the shared dev database unmodified.
- Confirmed empirically that `halfvec(N)`'s `atttypmod` encoding is identical to `vector(N)` (stores `N` directly) — `packages/core/src/runner/runner.ts`'s existing dimension fail-fast check needed no code change, and remains untouched (`git diff --quiet` confirms).
- Cross-referenced `0009_embedding_dimensions_fix.sql`'s header comment to point at 0011 for the >2000-dim case, without touching any of its three SQL statement lines (byte-identical diff-checked).

## What exactly the new migration does

`0011_gemini_highdim_halfvec_3072.sql` applies **unconditionally** — a plain, static SQL migration file registered in `packages/database/src/migrations/meta/_journal.json` (idx=11). There is **no runtime gating, no `EMBEDDING_DIMENSIONS` check, no conditional logic** in how it gets applied. `runMigrations()` (called from `BrainRunner.init()` on every container boot) applies every migration not yet recorded as applied for that tenant's database, in order, regardless of what embedding provider/dimension that tenant is configured for.

## CRITICAL — operational risk, why this was NOT merged to master

`apps/brain-sdr/Dockerfile` does `COPY packages/database/src/migrations ./migrations` — the entire folder, unfiltered, no flavor gating. If `0011` were on master and the standard `brain-sdr:1.5` image were rebuilt from a commit including it, **every existing 1536/OpenAI tenant sharing that image would have `embeddings`/`knowledge_chunks` `TRUNCATE`d and force-converted to `halfvec(3072)` on next boot** — silent data loss (conversation memory + RAG knowledge gone), not a crash, no warning, no confirmation prompt.

**Required before merging to master / building any image from this branch's descendant:** a build-time mechanism (separate Dockerfile target/flavor, or equivalent) that guarantees only Gemini/high-dim tenant images include `0011`, while the standard image build continues to exclude it. This is unresolved ops/build work, explicitly out of scope for this quick task.

**In the meantime**, to give a Gemini tenant (e.g. PIEDADE) a properly-indexed setup via image (rather than the manual `DROP INDEX`/`ALTER` SQL already applied directly to its DB as a stopgap), build a distinctly-tagged image FROM THIS BRANCH specifically (e.g. `brain-sdr:1.5-gemini`), never as `brain-sdr:1.5` / never from master, until the flavor-exclusion mechanism exists.

## Deviations from Plan

None — plan executed exactly as written. Task 3 (validation) produced no file changes, as anticipated.

One environment-level addition not listed as a plan task: `node_modules` did not exist in the execution worktree at start — ran `bun install` at the repo root (612 packages, migrated from `pnpm-lock.yaml`) before any verification command would run.

## Known Stubs

None.

## Next Phase Readiness

Blocked on a deliberate decision, not a technical gap: needs a Dockerfile/build-flavor strategy before this branch can merge to master. Recommend a small follow-up task once ops decides the flavor-exclusion mechanism (build ARG + target, or separate migrations folder per flavor).

---
*Phase: quick-260717-wpk*
*Completed: 2026-07-18*

## Self-Check: PASSED

- FOUND: packages/database/src/schema/tables.ts (modified, halfvec ternary present, on branch worktree-agent-a51d3dffce5d3b264)
- FOUND: packages/database/src/migrations/0011_gemini_highdim_halfvec_3072.sql (on branch worktree-agent-a51d3dffce5d3b264)
- FOUND commit 6b75752: feat(database): support halfvec for embeddings above 2000 dims
- FOUND commit e9e1c91: feat(database): add halfvec(3072) migration for Gemini embeddings
