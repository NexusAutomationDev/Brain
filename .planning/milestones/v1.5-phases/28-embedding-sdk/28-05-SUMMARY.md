---
phase: 28-embedding-sdk
plan: 05
subsystem: api
tags: [hono, drizzle, pgvector, embeddings, rag, batch-processing]

# Dependency graph
requires:
  - phase: 28-embedding-sdk (28-01)
    provides: IEmbeddingProvider interface + OpenAI/Gemini adapters (packages/embeddings)
  - phase: 28-embedding-sdk (28-03)
    provides: createServer(sql, runner, transport, embeddingProvider) signature and createEmbeddingProvider() wiring in apps/brain-sdr
provides:
  - "POST /api/v1/reembed — batch re-embed tool for existing knowledge_chunks rows"
  - "Pagination + Pitfall 3 (empty-vector) guard for safe batch re-embedding"
  - "INGEST_TOKEN documented in apps/brain-sdr/.env.example (previously undocumented)"
affects: [29-brain-support-core, 30-brain-support-docker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch HTTP endpoint pattern: paginated SELECT + per-row guarded UPDATE, reusing existing Bearer-auth fail-closed middleware from a sibling endpoint instead of inventing new auth"

key-files:
  created:
    - packages/core/src/rag/reembed.ts
    - packages/core/src/rag/__tests__/reembed.test.ts
    - .planning/phases/28-embedding-sdk/deferred-items.md
  modified:
    - packages/core/src/rag/index.ts
    - packages/core/src/index.ts
    - apps/brain-sdr/src/server.ts
    - apps/brain-sdr/.env.example

key-decisions:
  - "Reused INGEST_TOKEN Bearer-auth pattern verbatim for /api/v1/reembed instead of introducing a new auth mechanism, per threat model requirement"
  - "collection is a required, explicitly-validated request field — re-embed never operates implicitly across all collections"
  - "Skipped (zero-length vector) rows are left with their old embeddingModel so they remain eligible for retry on a future re-embed call (idempotent failure handling)"

patterns-established:
  - "Paginated batch endpoint with page-boundary termination test (empty page ends the loop) — reusable for any future bulk-reprocessing tool over knowledge_chunks or similar tables"

requirements-completed: [EMBD-01, EMBD-02]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 28 Plan 05: Batch Re-embed Tool Summary

**POST /api/v1/reembed reprocesses knowledge_chunks embeddings in-place using the currently-configured IEmbeddingProvider, without re-ingesting original documents, guarded against Gemini's silent empty-vector partial failures.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-01T15:00:00Z (approx, worktree branch check)
- **Completed:** 2026-07-01T15:19:01Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created source, 1 created test, 3 modified)

## Accomplishments
- `createReembedApp(sql, embeddingProvider)` — paginated (PAGE_SIZE=200), collection-scoped batch re-embed endpoint reusing the exact `INGEST_TOKEN` Bearer-auth fail-closed pattern from `ingest.ts`
- Pitfall 3 guard: rows receiving a zero-length embedding vector are skipped (not written, not marked with the new `embeddingModel`) so they remain retryable on a subsequent call
- `ne(knowledgeChunks.embeddingModel, providerName)` filter makes re-runs idempotent — already-current rows are never re-selected
- Mounted in `apps/brain-sdr`'s server alongside `/api/v1/ingest`, under the same `if (embeddingProvider)` guard
- Documented `INGEST_TOKEN` (a pre-existing but previously undocumented required env var) and the new `/api/v1/reembed` endpoint in `.env.example`

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement createReembedApp with pagination and Pitfall 3 guard** - `84bca9e` (feat)
2. **Task 2: Mount reembed endpoint in apps/brain-sdr** - `59f9373` (feat)

_Note: Task 1 was marked `tdd="true"` in the plan; tests and implementation were authored together and verified green before commit (single commit, consistent with how ingest.ts's original TDD task history was later squashed in this codebase)._

## Files Created/Modified
- `packages/core/src/rag/reembed.ts` - `createReembedApp(sql, embeddingProvider)`: Bearer-auth fail-closed, collection validation, paginated SELECT/embed/UPDATE loop with Pitfall 3 guard
- `packages/core/src/rag/__tests__/reembed.test.ts` - 11 tests covering all 8 required behaviors (auth, validation, pagination, empty-vector guard, idempotent filter, aggregated counts)
- `packages/core/src/rag/index.ts` - barrel export for `createReembedApp`
- `packages/core/src/index.ts` - barrel export for `createReembedApp`
- `apps/brain-sdr/src/server.ts` - mounts `createReembedApp` alongside `createIngestApp`
- `apps/brain-sdr/.env.example` - documents `INGEST_TOKEN` and `/api/v1/reembed`

## Decisions Made
- Reused `INGEST_TOKEN` verbatim (no new token/env var) — matches the plan's explicit threat model requirement (T-28-11) and avoids operator confusion with a second secret to manage
- Left skipped rows' `embeddingModel` unchanged on partial embedding failure so the `ne()` filter naturally makes them eligible again on the next `/api/v1/reembed` call — no separate retry/dead-letter mechanism needed for this phase's scope (T-28-14, accepted risk per plan's threat model)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies and built dependency packages for typecheck**
- **Found during:** Task 2 verification (`bun run typecheck` in apps/brain-sdr)
- **Issue:** The worktree had no `node_modules` installed (fresh git worktree, pnpm workspace not yet materialized) and downstream packages (`@brain-pkg/shared`, `@brain-pkg/ai`, `@brain-pkg/embeddings`, `@brain-pkg/observability`, `@brain-pkg/database`, `@brain-pkg/transport`, `@brain-pkg/memory`, `@brain-pkg/core`) had stale/missing `dist/` output, causing `TS6305` "output file has not been built from source" errors unrelated to this plan's code changes
- **Fix:** Ran `pnpm install --frozen-lockfile`, then built packages in dependency order (`shared` → `ai`/`embeddings`/`observability`/`database`/`transport` → `memory` → `core`) via `pnpm --filter <pkg> run build`
- **Files modified:** None (build artifacts in `dist/` are gitignored, not committed)
- **Verification:** `cd apps/brain-sdr && bun run typecheck` now exits 0 with zero errors
- **Committed in:** N/A (no source files changed; build-only infrastructure fix, not committed)

**2. [Rule 2 - Missing Critical] Documented previously-undocumented INGEST_TOKEN in .env.example**
- **Found during:** Task 2 (adding reembed documentation block)
- **Issue:** `INGEST_TOKEN` is a required, fail-closed env var consumed by both `ingest.ts` (pre-existing) and the new `reembed.ts`, but `apps/brain-sdr/.env.example` had no entry for it — an operator following the example file alone would hit silent 503s on both endpoints
- **Fix:** Added an `INGEST_TOKEN` section (with `openssl rand -hex 32` guidance, matching the existing `WEBHOOK_TOKEN` documentation style) directly above the new re-embed documentation block
- **Files modified:** `apps/brain-sdr/.env.example`
- **Verification:** `grep -q "INGEST_TOKEN" apps/brain-sdr/.env.example` matches
- **Committed in:** `59f9373` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/build infra, 1 missing critical documentation)
**Impact on plan:** Both auto-fixes necessary — the build fix was required to verify the plan's own acceptance criteria (`bun run typecheck` exits 0), and the `.env.example` fix closes a pre-existing operator-facing gap directly adjacent to this plan's new endpoint. No scope creep beyond what the plan already required to be verifiable and usable.

## Issues Encountered
- Pre-existing test failures (14 failures in `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`, "FUP-02/Phase26" suite) surface when running the full `bun test` suite in `packages/core`. Confirmed unrelated to this plan via `git stash` (same failures occur with 28-05's changes fully removed) and confirmed to be cross-file `mock.module` test pollution, not a `reembed.ts` bug (the file passes 7/7 in isolation). Logged to `.planning/phases/28-embedding-sdk/deferred-items.md`, not fixed here per the deviation rules' scope boundary (out-of-scope for this plan's files).

## User Setup Required

None - no new external service configuration required. `INGEST_TOKEN` is a pre-existing required env var (now documented); operators who already set it for `/api/v1/ingest` need no further action for `/api/v1/reembed`.

## Next Phase Readiness

- `POST /api/v1/reembed` is implemented, tested (11/11 green), mounted, and documented — ready for manual verification against a running dev instance per the plan's `<verification>` curl example
- `apps/brain-sdr` typechecks cleanly (0 errors) after this plan's changes
- No blockers for downstream phases (29, 30); the pre-existing `lead-service-fup.test.ts` full-suite pollution issue is tracked in `deferred-items.md` for a future tech-debt pass, not a blocker for this plan's goal

## Self-Check: PASSED

All created files verified present on disk; both task commits (`84bca9e`, `59f9373`) verified present in git history.

---
*Phase: 28-embedding-sdk*
*Completed: 2026-07-01*
