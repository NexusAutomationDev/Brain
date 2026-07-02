---
phase: 28-embedding-sdk
plan: 04
subsystem: memory
tags: [embeddings, brain-runner, langgraph, pgvector, dependency-injection]

# Dependency graph
requires:
  - phase: 28-embedding-sdk (Plan 01)
    provides: "packages/embeddings — IEmbeddingProvider interface + createEmbeddingProvider() factory (OpenAI/Gemini adapters)"
  - phase: 28-embedding-sdk (Plan 02)
    provides: "migration 0009 — ENV-driven vector(N) column on knowledge_chunks, fixes hardcoded vector(1536) (D-16)"
provides:
  - "BrainRunner resolves IEmbeddingProvider in init() (injected via BrainRunnerOptions.embeddingProvider for tests, or ENV-driven via createEmbeddingProvider() otherwise)"
  - "run() embeds event.Message before getContext() — semantic search now receives a real queryVector instead of always []"
  - "run() embeds profileValue before saveContext() — activates the previously dead upsertEmbedding() write path (closes MEM-03)"
  - "init() fail-fast dimension check (D-15) — process.exit(1) with a clear log line when embeddingProvider.dimensions doesn't match the live knowledge_chunks.embedding vector(N) column"
affects: [29-brain-suporte-core, 30-brain-suporte-docker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "embeddingProvider DI mirrors the existing eventPublisher pattern exactly (optional constructor injection, ENV-driven fallback resolved once in init())"
    - "D-10 graceful-fallback try/catch around every embeddingProvider call site — embedding failures never throw out of run(), they log and degrade (empty queryVector / omitted embedding field)"

key-files:
  created: []
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/core/src/runner/__tests__/runner-fup.test.ts
    - packages/core/src/runner/__tests__/runner-wr.test.ts

key-decisions:
  - "embeddingProvider is resolved unconditionally in init() (not gated behind an ENV presence check like eventPublisher) — D-09 makes it a blocking part of the main flow, not an optional side-channel"
  - "Dimension fail-fast check runs against knowledge_chunks.embedding via pg_attribute.atttypmod introspection, placed after runMigrations() and after embeddingProvider resolution — converts a would-be obscure Postgres error into a clear startup failure"
  - "All existing test fixtures using sql: {} as never had to become callable tagged-template mocks (mockSql / mockSqlWr / mockSqlFup) because init() now issues a real SQL query for the dimension check"

requirements-completed: [EMBD-05]

# Metrics
duration: ~55min
completed: 2026-07-01
---

# Phase 28 Plan 04: BrainRunner Embedding Wiring Summary

**BrainRunner now embeds the lead's message before semantic search and embeds saved profile context, closing the MEM-03 dead-write-path tech debt, with a D-15 startup fail-fast on dimension mismatch.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2
- **Files modified:** 5 (1 source, 3 test files, 1 deferred-items doc)

## Accomplishments
- `BrainRunnerOptions.embeddingProvider` optional DI slot added, mirroring the existing `eventPublisher` pattern; `init()` resolves it via `createEmbeddingProvider()` when not injected
- D-15 dimension fail-fast: `init()` queries `pg_attribute.atttypmod` for `knowledge_chunks.embedding` after migrations complete and calls `process.exit(1)` with a structured `EMBEDDING_DIMENSIONS mismatch` log line if it disagrees with `embeddingProvider.dimensions`
- `run()` embeds `event.Message` via `embedQuery()` before `getContext()` — the previously always-empty `queryVector` now carries a real vector, unblocking `MemoryManager.getContext()`'s `queryVector.length > 0` semantic-search branch
- `run()` embeds the turn's `profileValue` via `embed()` before `saveContext()`, populating the `embedding` field that activates `upsertEmbedding()` — the original MEM-03 dead write path is now reachable in production code
- Both embedding call sites are wrapped in D-10 graceful-fallback try/catch: a failed embedding call logs a `warn` with `threadId` and degrades (empty `queryVector` / omitted `embedding` field) instead of throwing and breaking the lead's turn

## Task Commits

Each task was committed atomically:

1. **Task 1: Add embeddingProvider DI + dimension fail-fast check to BrainRunner.init()** - `95dfebc` (feat)
2. **Task 2: Wire embeddingProvider into run() at query-time and save-time** - `5858fb7` (feat)

**Deferred items documentation:** `6c94882` (docs)

_Note: this plan used tdd="true" tasks; tests were written and iterated alongside implementation within each task commit rather than as separate RED/GREEN commits, since the existing test-suite conventions in this file batch test additions with the source change per task._

## Files Created/Modified
- `packages/core/src/runner/runner.ts` - Adds `embeddingProvider` field/option, D-15 dimension check in `init()`, embed-before-getContext and embed-before-saveContext wiring in `run()`, both with D-10 fallback
- `packages/core/src/runner/__tests__/brain-runner.test.ts` - New `EMBD-05` describe blocks (DI + dimension fail-fast, query/save-time wiring); upgraded all `sql: {} as never` fixtures to a callable tagged-template mock (`mockSql`) since `init()` now issues a real dimension-check query; added `@brain-pkg/embeddings` module mock
- `packages/core/src/runner/__tests__/runner-fup.test.ts` - Added `@brain-pkg/embeddings` mock and callable `mockSqlFup` fixture (same reason)
- `packages/core/src/runner/__tests__/runner-wr.test.ts` - Added `@brain-pkg/embeddings` mock and callable `mockSqlWr` fixture (same reason)

## Decisions Made
- embeddingProvider resolution is unconditional in `init()` (unlike `eventPublisher`, which only initializes when `TOOL_EVENTS_QUEUE`/`TOOL_EVENTS_URL` are set) — D-09 explicitly requires embedding to be part of the blocking main flow, not an opt-in side channel
- The D-15 dimension check targets `knowledge_chunks.embedding` (not the `embeddings` table) — this is the column migration 0009 (Plan 02) makes ENV-driven, and the one at risk of silent mismatch if `EMBEDDING_DIMENSIONS` changes without a new migration
- Chose to extend the 3 existing runner test files' `sql` fixtures into callable tagged-template mocks rather than skip the dimension-check query in tests — keeps the D-15 behavior exercised by every existing test instead of being invisible until integration/production

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated runner-fup.test.ts and runner-wr.test.ts sql fixtures to callable mocks**
- **Found during:** Task 1 (after adding the D-15 dimension query to `init()`)
- **Issue:** These two test files (not explicitly listed in the plan's `files_modified` frontmatter, but exercising `BrainRunner.init()`) used `sql: {} as never` — a non-callable object. Once `init()` began issuing `` this.sql<...>`...` `` for the dimension check, every test in both files would throw `TypeError: this.sql is not a function`.
- **Fix:** Added a `@brain-pkg/embeddings` module mock and a callable tagged-template `mock()` fixture (`mockSqlFup`, `mockSqlWr`) resolving `[{ dimensions: 1536 }]`, matching the default mock provider's `dimensions: 1536`.
- **Files modified:** `packages/core/src/runner/__tests__/runner-fup.test.ts`, `packages/core/src/runner/__tests__/runner-wr.test.ts`
- **Verification:** `bun test src/runner/__tests__/runner-wr.test.ts src/runner/__tests__/runner-fup.test.ts` — 10/10 pass
- **Committed in:** `95dfebc` (Task 1 commit)

**2. [Rule 1 - Bug] D-03 test's sentinel sql object made callable**
- **Found during:** Task 1
- **Issue:** `brain-runner.test.ts`'s "D-03: _compileGraph passes sql to BrainBuildContext" test used a plain `{ tag: "sql-sentinel" }` object to verify reference identity via `ctx.sql).toBe(sqlInstance)`. This object is also non-callable and would break under the new dimension query.
- **Fix:** Wrapped the sentinel in `Object.assign(mock(async () => [{ dimensions: 1536 }]), { tag: "sql-sentinel" })` — preserves both callability and the `.tag` marker used for the identity assertion.
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Verification:** Test passes; `ctx.sql).toBe(sqlInstance)` still holds since `Object.assign` mutates and returns the same reference.
- **Committed in:** `95dfebc` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3/Rule 1 — blocking test breakage caused by the new D-15 query, fixed inline within Task 1's scope)
**Impact on plan:** Both fixes were necessary to keep the existing test suite green after the D-15 dimension check was added; no scope creep — same files the plan already anticipated touching indirectly (BrainRunner test fixtures).

## Issues Encountered
- Worktree had no `node_modules` installed initially — `pnpm install --frozen-lockfile` was run at the repo root to restore dependencies before tests/typecheck could execute. This is an environment-setup step, not a plan deviation; no source files were affected.
- Several workspace packages (`shared`, `observability`, `database`, `ai`, `memory`, `embeddings`, `transport`) had stale/missing `dist/` output causing `TS6305` errors under `tsc --noEmit`. Ran `bun run build` in each package to regenerate `.d.ts` output before re-running `packages/core`'s typecheck, which then passed cleanly (0 errors). No source changes required.
- `bun run lint` in `packages/core` reports 3 pre-existing errors (`no-empty-function` in `event-publisher.ts` and a pre-existing MCP-close catch in `runner.ts`) and several pre-existing `no-non-null-assertion` warnings. Verified byte-identical against the unmodified base commit (`7cd742a`) — see `deferred-items.md`. The only new warnings introduced by this plan are the two `this.embeddingProvider!` non-null assertions explicitly called for by the plan's Task 2 action block; these are not regressions.
- `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` has 14 pre-existing failures, confirmed unrelated to this plan (LeadService, not BrainRunner/embeddings) by stashing all 28-04 changes and re-running the full suite against the unmodified base — same failures reproduce. Logged in `deferred-items.md`, not fixed (out of scope per deviation-rules scope boundary).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- EMBD-05 is fully met: `BrainRunner` calls the embedding provider at both query-time (blocking, D-09) and save-time (D-08), with graceful fallback (D-10) at both points, and `init()` fails fast on dimension mismatch (D-15) before accepting any message.
- The previously dead `upsertEmbedding()` semantic-write path (MEM-03) is now reachable in production code — closes the last open Embedding SDK tech debt item ahead of Phase 29 (Brain Suporte Core), which depends on `IEmbeddingProvider` being fully wired.
- Two unrelated, pre-existing issues remain logged in `deferred-items.md` for future cleanup: `lead-service-fup.test.ts`'s 14 failing tests, and `packages/core`'s pre-existing lint errors/warnings (both confirmed present on the base branch prior to this plan).

---
*Phase: 28-embedding-sdk*
*Completed: 2026-07-01*
