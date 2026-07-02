---
phase: 28-embedding-sdk
plan: 03
subsystem: rag
tags: [embeddings, rag, pgvector, ioc, langchain, hono]

# Dependency graph
requires:
  - phase: 28-embedding-sdk (Plan 01)
    provides: "IEmbeddingProvider interface, OpenAIEmbeddingProvider, GeminiEmbeddingProvider, createEmbeddingProvider() factory in @brain-pkg/embeddings"
provides:
  - "search-knowledge.ts and ingest.ts take an injected IEmbeddingProvider instead of calling createEmbeddings()"
  - "packages/ai has zero embedding code — single embedding code path in the repo"
  - "Pitfall 3 guard in ingest.ts: partial/total embedding failure no longer silently corrupts knowledge_chunks"
  - "apps/brain-sdr resolves IEmbeddingProvider once at startup and injects it into both RAG call sites"
affects: [28-embedding-sdk (Plan 04, Plan 05), brain-suporte]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IEmbeddingProvider injected as constructor param (not resolved internally) — mirrors sql injection pattern already used by createPauseSessionTool/createFinishConversationTool"
    - "LazyEmbeddingProvider: when a sync interface (IBrain.buildGraph) must construct something built by an async factory, wrap it in a class that defers/memoizes the async resolution to first real method call instead of forcing the interface to become async"

key-files:
  created: []
  modified:
    - packages/core/src/tools/search-knowledge.ts
    - packages/core/src/rag/ingest.ts
    - packages/core/src/rag/search.ts
    - packages/core/src/rag/index.ts
    - packages/core/src/tools/__tests__/search-knowledge.test.ts
    - packages/core/src/rag/__tests__/ingest.test.ts
    - packages/core/package.json
    - packages/core/tsconfig.json
    - packages/ai/src/index.ts
    - packages/ai/package.json
    - apps/brain-sdr/src/brain.ts
    - apps/brain-sdr/src/server.ts
    - apps/brain-sdr/src/index.ts
    - apps/brain-sdr/package.json
    - apps/brain-sdr/tsconfig.json

key-decisions:
  - "packages/ai/src/embeddings/ deleted entirely (factory.ts + its test) — D-01 extract-not-duplicate honored"
  - "resolveEmbeddingModel() removed from packages/core/src/rag/search.ts (and its barrel re-export) after confirming zero remaining in-repo callers post Task 1"
  - "brain.ts's buildGraph() stays synchronous per the IBrain contract (unchanged file scope) — LazyEmbeddingProvider defers createEmbeddingProvider()'s async resolution to the tool's first real embed()/embedQuery() call, memoized per process"
  - "createServer()'s embeddingProvider param is optional (mirrors existing optional transport? param) but apps/brain-sdr/index.ts always resolves and passes it in production"

patterns-established:
  - "Pitfall 3 guard: filter embedding results for zero-length vectors before persisting; return 502 only when ALL vectors are empty, otherwise insert the valid subset and log a warning with counts only (never chunk content)"

requirements-completed: [EMBD-01, EMBD-02]

# Metrics
duration: 55min
completed: 2026-07-01
---

# Phase 28 Plan 03: Wire IEmbeddingProvider into RAG call sites Summary

**Replaced `createEmbeddings()` (packages/ai) with injected `IEmbeddingProvider` (packages/embeddings) in search-knowledge.ts and ingest.ts, deleted the now-dead packages/ai embedding factory, and added a Pitfall-3 guard against Gemini's silent per-batch empty-vector failures in ingest.ts.**

## Performance

- **Duration:** 55 min (includes waiting for sibling worktree's Plan 28-01 to complete and merging it in)
- **Started:** 2026-07-01T13:21:00Z (approx, first test run)
- **Completed:** 2026-07-01T14:20:48Z
- **Tasks:** 2/2
- **Files modified:** 15 (13 in Task 2 commit + 5 in Task 1 commit, 3 overlapping via package.json/tsconfig additions)

## Accomplishments
- `search-knowledge.ts` and `ingest.ts` now take an injected `IEmbeddingProvider` — zero references to `createEmbeddings()` remain anywhere in the repo (only in doc comments explaining the historical name)
- `packages/ai/src/embeddings/` deleted entirely — single embedding code path in the codebase (D-02 mandate satisfied)
- D-17's `embedding_model` filter now sourced directly from `embeddingProvider.providerName`, removing the drift risk between the filter value and the actual embedding call
- `ingest.ts` gained a real guard against partial/total embedding failure: partial failure persists only the successfully-embedded chunks (renumbering `chunkIndex`/`totalChunks` for internal consistency), total failure returns `502` without touching the DB
- `apps/brain-sdr` resolves `IEmbeddingProvider` once at startup (`index.ts`) and threads it through `createServer()` → `createIngestApp()`; `brain.ts`'s `search_knowledge` tool gets its own lazily-resolved provider instance

## Task Commits

1. **Task 1: Wire IEmbeddingProvider into search-knowledge.ts and ingest.ts** - `7a249cf` (feat)
2. **Task 2: Delete packages/ai embedding dead code and update apps/brain-sdr call sites** - `b4edbe3` (refactor)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/core/src/tools/search-knowledge.ts` - `createSearchKnowledgeTool(sql, embeddingProvider, searchFn?)` — calls `embeddingProvider.embedQuery()`/`.providerName` instead of `createEmbeddings()`/`resolveEmbeddingModel()`
- `packages/core/src/rag/ingest.ts` - `createIngestApp(sql, embeddingProvider)` — calls `embeddingProvider.embed()`, adds Pitfall 3 empty-vector guard before INSERT
- `packages/core/src/rag/search.ts` - removed dead `resolveEmbeddingModel()` (superseded by injected provider's `providerName`)
- `packages/core/src/rag/index.ts` - barrel export no longer re-exports `resolveEmbeddingModel`
- `packages/core/src/tools/__tests__/search-knowledge.test.ts` - mock `IEmbeddingProvider` object replaces `mock.module("@brain-pkg/ai", ...)`; new tests for `embedQuery` call count and `providerName` propagation
- `packages/core/src/rag/__tests__/ingest.test.ts` - same mock replacement; two new Pitfall-3 tests (partial failure → 200 with N-1 chunks, total failure → 502, no insert)
- `packages/core/package.json` / `packages/core/tsconfig.json` - added `@brain-pkg/embeddings` dependency + project reference
- `packages/ai/src/embeddings/` - deleted (factory.ts + factory.test.ts)
- `packages/ai/src/index.ts` / `packages/ai/package.json` - removed `createEmbeddings` export and `src/embeddings` from test script
- `apps/brain-sdr/src/brain.ts` - `LazyEmbeddingProvider` wrapper class + `createEmbeddingProvider()` import; `boundSearchKnowledgeTool` now receives it
- `apps/brain-sdr/src/server.ts` - `createServer()` accepts optional `embeddingProvider`, mounts `/api/v1/ingest` only when present
- `apps/brain-sdr/src/index.ts` - resolves `IEmbeddingProvider` once in `main()`, passes to `createServer()`
- `apps/brain-sdr/package.json` / `apps/brain-sdr/tsconfig.json` - added `@brain-pkg/embeddings` dependency + project reference

## Decisions Made
- **LazyEmbeddingProvider pattern (brain.ts):** `IBrain.buildGraph()` is strictly synchronous per its interface contract (`packages/core/src/brain/interface.ts`, not in this plan's file scope), but `createEmbeddingProvider()` is `async`. Rather than changing the `IBrain` interface (an architectural change out of scope for this plan) or threading `embeddingProvider` through `BrainBuildContext` (explicitly deferred to Plan 04 per the plan's own text), a `LazyEmbeddingProvider` class implementing `IEmbeddingProvider` defers the real async resolution to the first `embed()`/`embedQuery()` call, memoizing the resolved provider in a module-level promise. `providerName`/`dimensions` are getters backed by the resolved instance — correct because `search-knowledge.ts` only reads `providerName` after `await embeddingProvider.embedQuery(...)` has resolved.
- **`resolveEmbeddingModel()` removal:** confirmed via repo-wide grep that no in-repo caller imports it after Task 1's changes (only the dead barrel re-export referenced it) — removed per the plan's explicit instruction, rather than leaving it as unused dead code.
- **tsconfig project references:** `packages/core/tsconfig.json` and `apps/brain-sdr/tsconfig.json` were missing a `references` entry for `../embeddings` / `../../packages/embeddings` — without it, `tsc --build`/`--noEmit` fails with `TS6059`/`TS6307` (file not under rootDir / not listed in project). This wasn't in the plan's original file list but was a hard blocker for typecheck to pass with the new `@brain-pkg/embeddings` import — added as a Rule 3 auto-fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 28-01 (packages/embeddings) not yet merged into this worktree at start of execution**
- **Found during:** Pre-task setup (reading `packages/embeddings/src/provider.interface.ts`)
- **Issue:** This plan's wave (wave 1) `depends_on: ["28-01"]` (wave 0), but the orchestrator's parallel worktree model meant `packages/embeddings` did not exist yet in this worktree — plan 28-01 was still executing concurrently in a sibling worktree (`worktree-agent-a8b754d22b4de3e13`)
- **Fix:** Monitored the sibling worktree until plan 28-01 committed its final `docs(28-01)` summary commit, then fast-forward merged `worktree-agent-a8b754d22b4de3e13` into this branch to bring in `packages/embeddings` and its `tsconfig.base.json`/root `package.json` changes before starting Task 1
- **Files modified:** none directly (merge commit brought in Plan 01's files unchanged)
- **Verification:** `pnpm install` resolved `@brain-pkg/embeddings` with no missing-package errors; `IEmbeddingProvider` interface matched this plan's `<interfaces>` block exactly
- **Committed in:** fast-forward merge (no new commit hash — `a15e2f6` became this branch's new base)

**2. [Rule 3 - Blocking] Missing tsconfig project references for @brain-pkg/embeddings**
- **Found during:** Task 2 (typecheck verification for apps/brain-sdr and packages/core)
- **Issue:** `tsc --noEmit` failed with `TS6059`/`TS6307` ("file not under rootDir" / "not listed in project") for every file in `packages/embeddings/src` once imported from `packages/core` and `apps/brain-sdr` — the `references` array in both packages' `tsconfig.json` was missing an entry for the new dependency
- **Fix:** Added `{ "path": "../embeddings" }` to `packages/core/tsconfig.json` and `{ "path": "../../packages/embeddings" }` to `apps/brain-sdr/tsconfig.json`
- **Files modified:** packages/core/tsconfig.json, apps/brain-sdr/tsconfig.json
- **Verification:** `bun run typecheck` (and `turbo run typecheck --filter=...`) passes with 0 errors for `@brain-pkg/core`, `@brain-pkg/ai`, `@brain-app/sdr`, `@brain-pkg/embeddings`
- **Committed in:** `b4edbe3` (Task 2 commit)

**3. [Rule 4-adjacent, resolved within existing constraints] buildGraph() cannot await createEmbeddingProvider() directly**
- **Found during:** Task 2 (apps/brain-sdr/src/brain.ts call site update)
- **Issue:** The plan's action text says to `await createEmbeddingProvider()` directly inside `buildGraph()`'s body, but `IBrain.buildGraph(ctx): StateGraph<...>` is a synchronous interface method (not `Promise<StateGraph<...>>`) per `packages/core/src/brain/interface.ts` — a file explicitly not in this plan's `files_modified` list. A literal `await` there would be a TypeScript compile error, and changing `IBrain` to be async is an architectural interface change affecting every future Brain, which is Plan 04's territory (per the plan's own text: "NOT yet threaded through BrainBuildContext")
- **Fix:** Implemented `LazyEmbeddingProvider`, a class satisfying `IEmbeddingProvider` that defers `createEmbeddingProvider()`'s resolution to the first `embed()`/`embedQuery()` call (memoized per process via a module-level promise), keeping `buildGraph()` fully synchronous while still constructing the real provider exactly once
- **Files modified:** apps/brain-sdr/src/brain.ts
- **Verification:** `bun test src/__tests__/unit` (apps/brain-sdr) passes 31/31; `bun run typecheck` passes with 0 errors
- **Committed in:** `b4edbe3` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 blocking-adjacent architectural workaround within existing interface constraints)
**Impact on plan:** All three were necessary to complete the plan as specified without expanding scope into other plans' territory (Plan 01's package, Plan 04's BrainBuildContext threading). No unrelated scope creep.

## Issues Encountered
- `packages/shared/dist` and other packages' `dist/` directories didn't exist yet in this worktree (never built) — `tsc --noEmit` with project references fails with `TS6305` until dependencies are built. Resolved by running `bun run build` in each dependency package (`shared`, `database`, `observability`, `transport`, `memory`, `ai`, `embeddings`, `core`) before the final typecheck pass. `dist/` is git-ignored, so no untracked files were left behind.
- Pre-existing test failures found in `packages/core`'s full `bun test` run (14 failures in `src/__tests__/unit/fup/lead-service-fup.test.ts`, an unrelated FUP feature test file). Verified via `git stash`/`git stash pop` that these failures reproduce identically with this plan's changes fully reverted — confirmed pre-existing and out of scope (SCOPE BOUNDARY rule). Not fixed; not caused by this plan's changes. Logged here for visibility, not added to `deferred-items.md` since no plan file touches that test.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04 (BrainRunner DI wiring) can now build on a real `IEmbeddingProvider` injection pattern at both existing RAG call sites — the `LazyEmbeddingProvider` workaround in `brain.ts` is a stopgap Plan 04 should replace once `BrainBuildContext` carries `embeddingProvider` natively (per this plan's own note that Plan 04 owns that threading)
- Plan 05 (re-embed tool, depends on 28-01 + 28-03) can rely on `ingest.ts`'s Pitfall 3 guard pattern as a reference implementation for its own partial-failure handling
- No blockers for downstream plans in this phase

---
*Phase: 28-embedding-sdk*
*Completed: 2026-07-01*

## Self-Check: PASSED

All 15 modified/created files verified present on disk. `packages/ai/src/embeddings/factory.ts` confirmed deleted. Both task commits (`7a249cf`, `b4edbe3`) verified present in `git log --oneline --all`.
