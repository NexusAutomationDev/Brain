---
phase: 28-embedding-sdk
plan: 01
subsystem: embeddings
tags: [langchain, openai, gemini, embeddings, factory-pattern, bun-test]

# Dependency graph
requires: []
provides:
  - "packages/embeddings package with IEmbeddingProvider interface"
  - "OpenAIEmbeddingProvider and GeminiEmbeddingProvider classes"
  - "createEmbeddingProvider() factory with EMBEDDING_PROVIDER/LLM_PROVIDER resolution"
  - "Fix for deprecated Gemini text-embedding-004 model (now gemini-embedding-001)"
affects: [28-02-migration, 28-03-caller-wiring, brain-runner-di, re-embed-tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IEmbeddingProvider contract: embed() for batch/ingest, embedQuery() for single-text/search (D-20)"
    - "Lazy embedder instantiation via dynamic import in provider classes (mirrors createLLM pattern)"
    - "EMBEDDING_PROVIDER resolution independent from LLM_PROVIDER, with capability-aware fallback (D-11/D-12/D-13)"
    - "Mock underlying SDK packages (not sibling modules under direct test) in bun:test to avoid mock.module cross-file cache contamination"

key-files:
  created:
    - packages/embeddings/package.json
    - packages/embeddings/tsconfig.json
    - packages/embeddings/src/provider.interface.ts
    - packages/embeddings/src/openai-provider.ts
    - packages/embeddings/src/gemini-provider.ts
    - packages/embeddings/src/factory.ts
    - packages/embeddings/src/index.ts
    - packages/embeddings/src/__tests__/unit/openai-provider.test.ts
    - packages/embeddings/src/__tests__/unit/gemini-provider.test.ts
    - packages/embeddings/src/__tests__/unit/factory.test.ts
  modified:
    - tsconfig.base.json

key-decisions:
  - "Gemini default model changed from deprecated text-embedding-004 to gemini-embedding-001 (D-03)"
  - "Gemini default dimensions fixed at 3072 (D-18) — installed LangChain wrapper exposes no reduction parameter"
  - "IEmbeddingProvider includes both embed() and embedQuery() per D-20, not just the literal EMBD-01 text"
  - "Factory tests mock @langchain/openai and @langchain/google-genai directly instead of sibling provider modules, avoiding Bun's known mock.module cross-file cache contamination"

patterns-established:
  - "Provider classes never log/throw apiKey (T-2-03) — verified via source grep in acceptance criteria"
  - "ConfigurationError context never includes apiKey, only the invalid provider name (T-28-01 mitigation)"

requirements-completed: [EMBD-01, EMBD-02, EMBD-04]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 28 Plan 01: Embedding SDK Foundation Summary

**`packages/embeddings` package with provider-agnostic `IEmbeddingProvider`, OpenAI/Gemini adapters, and env-driven factory — fixes deprecated Gemini model as a side effect**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-01T12:52:00Z (approx)
- **Completed:** 2026-07-01T13:17:00Z
- **Tasks:** 3
- **Files modified:** 11 (10 created, 1 modified)

## Accomplishments
- Created `packages/embeddings` package registered in the workspace and `tsconfig.base.json` paths map
- `IEmbeddingProvider` interface with `embed()`/`embedQuery()`/`dimensions`/`providerName`, implementable by any provider without touching `packages/core` or `packages/database`
- `OpenAIEmbeddingProvider` and `GeminiEmbeddingProvider` classes, both config-driven via `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`/`API_KEY` env vars
- Fixed the already-occurring production bug where Gemini's `text-embedding-004` model is deprecated — new default is `gemini-embedding-001` with 3072 dimensions
- `createEmbeddingProvider()` factory resolving `EMBEDDING_PROVIDER` independently from `LLM_PROVIDER`, with capability-aware fallback (D-12: anthropic excluded, falls back to openai) and `ConfigurationError` on unknown providers
- 22 unit tests across 3 files, all green; `bun run typecheck` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold packages/embeddings and define IEmbeddingProvider contract** - `ceb3061` (feat)
2. **Task 2: Implement OpenAIEmbeddingProvider and GeminiEmbeddingProvider** - `4be5760` (test, RED) + `621b192` (feat, GREEN)
3. **Task 3: Implement createEmbeddingProvider() factory with EMBEDDING_PROVIDER resolution** - `d3434ff` (test, RED) + `9de2e76` (feat, GREEN)

_TDD tasks (2, 3) each produced a RED commit (failing test) followed by a GREEN commit (implementation)._

## Files Created/Modified
- `packages/embeddings/package.json` - workspace package manifest, mirrors `packages/ai`
- `packages/embeddings/tsconfig.json` - extends tsconfig.base.json, references `../shared`
- `packages/embeddings/src/provider.interface.ts` - `IEmbeddingProvider` contract (embed, embedQuery, dimensions, providerName)
- `packages/embeddings/src/openai-provider.ts` - `OpenAIEmbeddingProvider`, lazy `OpenAIEmbeddings` instantiation
- `packages/embeddings/src/gemini-provider.ts` - `GeminiEmbeddingProvider`, fixes deprecated model, documents D-18 dimension limitation
- `packages/embeddings/src/factory.ts` - `createEmbeddingProvider()` + `resolveEmbeddingProviderName()`
- `packages/embeddings/src/index.ts` - barrel export (5 exports: interface + 2 classes + 2 factory functions)
- `packages/embeddings/src/__tests__/unit/openai-provider.test.ts` - 6 tests
- `packages/embeddings/src/__tests__/unit/gemini-provider.test.ts` - 5 tests
- `packages/embeddings/src/__tests__/unit/factory.test.ts` - 11 tests
- `tsconfig.base.json` - added `@brain-pkg/embeddings` paths entry (alphabetically between database and observability)

## Decisions Made
- Followed plan's interface/class/factory shapes verbatim (ported from `packages/ai/src/embeddings/factory.ts` and `packages/ai/src/llm/factory.ts` patterns)
- Did NOT delete or modify `packages/ai/src/embeddings/` — that is Plan 03's responsibility per the plan's explicit scope boundary

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed factory.test.ts mock.module cross-file contamination**
- **Found during:** Task 3, running full `bun test src/__tests__/unit` suite
- **Issue:** The plan's action instructs mocking `./openai-provider.js` and `./gemini-provider.js` via `mock.module` in `factory.test.ts`. Bun's `mock.module` patches the global module registry by resolved file path, so mocking those two sibling files (which are also directly imported/tested by `openai-provider.test.ts` and `gemini-provider.test.ts`) caused those provider tests to fail with `TypeError: ... is not a function` when the full suite ran in one process (2 of 22 tests failed depending on file run order). `mock.restore()` does not undo `mock.module` registry patches in Bun 1.3.2.
- **Fix:** Rewrote `factory.test.ts` to mock the underlying LangChain SDK packages (`@langchain/openai`, `@langchain/google-genai`) instead of the sibling provider modules — identical mock shape to what `openai-provider.test.ts`/`gemini-provider.test.ts` already use, so no behavior mismatch. This follows the existing project convention seen in `packages/core/src/tools/__tests__/search-knowledge.test.ts` ("Mock de searchKnowledge via DI — evita mock.module que contamina cache entre arquivos").
- **Files modified:** `packages/embeddings/src/__tests__/unit/factory.test.ts`
- **Verification:** `bun test src/__tests__/unit` (all files together, multiple run orders) — 22 pass, 0 fail
- **Committed in:** `9de2e76` (part of Task 3's GREEN commit)

**2. [Rule 3 - Blocking issue] Built packages/shared before typecheck**
- **Found during:** Task 3, running `bun run typecheck` in `packages/embeddings`
- **Issue:** `tsc --noEmit` failed with `TS6305: Output file '.../packages/shared/dist/index.d.ts' has not been built from source file` — a pre-existing condition in this fresh worktree (also reproduces identically in `packages/ai`, unrelated to this plan's changes) since TypeScript project references require `packages/shared`'s `dist/` to exist before dependents can typecheck.
- **Fix:** Ran `npx turbo run build --filter=@brain-pkg/shared` to build the missing `dist/` output. No source code change; `dist/` is gitignored so this has no git-visible effect.
- **Files modified:** none (build artifact only, gitignored)
- **Verification:** `bun run typecheck` in `packages/embeddings` now exits 0
- **Committed in:** N/A (no files to commit — build artifact only)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 - test isolation bug, 1 Rule 3 - blocking build dependency)
**Impact on plan:** Both fixes were necessary to satisfy the plan's own verification commands (`bun test src/__tests__/unit`, `bun run typecheck`). No scope creep — no production code behavior changed beyond what Tasks 1-3 specified.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`packages/embeddings` is fully self-contained, typechecked, and unit-tested. `IEmbeddingProvider`, `OpenAIEmbeddingProvider`, `GeminiEmbeddingProvider`, and `createEmbeddingProvider()` are all exported from the package barrel and ready for:
- Plan 03 (caller wiring): replace `packages/ai/src/embeddings/factory.ts` callers with `@brain-pkg/embeddings`
- Plan 04 (BrainRunner DI): inject `IEmbeddingProvider` via `createEmbeddingProvider()`
- Re-embed tool: consume `IEmbeddingProvider.embed()`/`embedQuery()`

No blockers. `packages/ai/src/embeddings/` was intentionally left untouched (Plan 03's scope).

---
*Phase: 28-embedding-sdk*
*Completed: 2026-07-01*

## Self-Check: PASSED

All 11 claimed created/modified files verified present on disk. All 5 claimed commit hashes (ceb3061, 4be5760, 621b192, d3434ff, 9de2e76) verified present in `git log --oneline --all`.
