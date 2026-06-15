---
phase: 10-output-parser-sdk
plan: 02
subsystem: api
tags: [langgraph, zod, brain-runner, state-annotation, brain-output, output-parser]

requires:
  - phase: 10-output-parser-sdk/10-01
    provides: BrainOutput interface in @brain-pkg/shared, BrainOutputSchema (Zod) in packages/core, BrainOutputValidationError in @brain-pkg/shared

provides:
  - BrainStateAnnotation with brainOutput field (last-write-wins reducer, default null)
  - BrainRunner.run() returns Promise<BrainOutput | null> instead of { reply: string }
  - BrainOutputValidationError thrown when brainOutput is null or fails Zod schema
  - BrainRunResult interface removed from runner.ts and core barrel

affects:
  - 10-03-PLAN.md (handler.ts needs to handle BrainOutput instead of { reply })
  - apps/brain-sdr (graph node must set state.brainOutput or get BrainOutputValidationError at runtime)
  - apps/brain-echo (same requirement as brain-sdr)

tech-stack:
  added: []
  patterns:
    - "BrainStateAnnotation extended with brainOutput: Annotation<BrainOutput | null> — last-write-wins, default null"
    - "BrainRunner validates graph output with BrainOutputSchema.parse() and re-throws as BrainOutputValidationError"
    - "BrainOutput imported from @brain-pkg/shared in packages/ai (not packages/core) to avoid circular dependency"

key-files:
  created: []
  modified:
    - packages/ai/src/graph/state.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts

key-decisions:
  - "BrainOutput imported from @brain-pkg/shared in BrainStateAnnotation (not @brain-pkg/core) — core already depends on ai, importing from core would create a cycle; shared is the leaf package"
  - "BrainRunResult interface removed entirely — callers now use BrainOutput from @brain-pkg/shared directly"
  - "BaseMessage import kept in runner.ts — still used for historicalMessages typing from getState snapshot"
  - "ZodError re-thrown as BrainOutputValidationError for typed error handling in handler.ts (T-10-04)"
  - "rawOutput included in BrainOutputValidationError context for internal debugging (T-10-06: not exposed to client)"

patterns-established:
  - "Graph node contract: every Brain node MUST set state.brainOutput before reaching __end__; failure throws BrainOutputValidationError"
  - "Output validation pattern: null check → Zod parse → re-throw as typed error"

requirements-completed: [PARSER-01, PARSER-02]

duration: 35min
completed: 2026-06-15
---

# Phase 10 Plan 02: BrainRunner Output Contract Summary

**BrainStateAnnotation extended with brainOutput field and BrainRunner.run() now returns validated BrainOutput | null with BrainOutputValidationError on null or schema mismatch**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-15T03:35:00Z
- **Completed:** 2026-06-15T03:52:00Z
- **Tasks:** 2 (Task 1: state.ts, Task 2: TDD runner + tests)
- **Files modified:** 3

## Accomplishments

- Added `brainOutput: Annotation<BrainOutput | null>` to `BrainStateAnnotation` with last-write-wins reducer — any Brain graph node can now set structured output
- Replaced `BrainRunner.run()` return type from `BrainRunResult | null` (`{ reply: string }`) to `BrainOutput | null` — closes the structured output contract
- Implemented two-layer validation: null guard + `BrainOutputSchema.parse()` both throw `BrainOutputValidationError` — enforces the "node must set brainOutput" rule at runtime
- Removed `BrainRunResult` interface — fully eliminated the old text-extraction path (`lastAI.content`)
- Updated all 17 BrainRunner unit tests: 17 pass, 0 fail (TDD: RED → GREEN)

## Task Commits

Each task was committed atomically:

1. **Task 1: Adicionar brainOutput ao BrainStateAnnotation** - `1f73007` (feat)
2. **Task 2: TDD RED — updated tests** - `7eb73b6` (test)
3. **Task 2: TDD GREEN — runner updated** - `f48c700` (feat)

_Note: Task 2 is TDD so it has two commits (test RED → feat GREEN)_

## Files Created/Modified

- `packages/ai/src/graph/state.ts` — Added `import type { BrainOutput } from "@brain-pkg/shared"` and `brainOutput` field with Annotation
- `packages/core/src/runner/runner.ts` — Removed `BrainRunResult`, changed `run()` signature, added BrainOutputSchema validation, BrainOutputValidationError throws, removed old reply extraction
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — Updated all tests to expect `BrainOutput` return; added 2 D-14 validation tests; 17/17 pass

## Decisions Made

- **BrainOutput import in packages/ai**: imported from `@brain-pkg/shared` (not `@brain-pkg/core`) to avoid the circular dependency — `core` already depends on `ai`, so `ai` cannot import from `core`
- **BaseMessage kept**: still needed at line 187 for `historicalMessages: BaseMessage[]` typing from getState snapshot
- **rawOutput in error context**: included in `BrainOutputValidationError` for internal debugging; handler.ts must not forward it to the client (T-10-06)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copy .env to worktree for bun test DATABASE_URL**
- **Found during:** Task 2 (running TDD RED tests)
- **Issue:** The worktree lacked `.env` file. Bun test runner loads `.env` automatically; without it, `DATABASE_URL` was unset. `_compileGraph()` calls `process.exit(1)` when DATABASE_URL is absent, causing bun test to hang silently instead of failing
- **Fix:** Copied `/root/Brain/.env` to `/root/Brain/.claude/worktrees/agent-a2ef395ad091503b8/.env`
- **Files modified:** `.env` (worktree only, not committed — in .gitignore)
- **Verification:** Tests ran and produced RED output as expected
- **Committed in:** not committed (env file)

**2. [Rule 3 - Blocking] pnpm install in worktree to resolve workspace packages**
- **Found during:** Task 2 (initial test run in worktree)
- **Issue:** Worktree had no `node_modules` for `@langchain/core` and workspace packages had no `node_modules`; pnpm workspace symlinks needed re-resolution after worktree creation
- **Fix:** Ran `pnpm install --no-frozen-lockfile` in worktree root (lockfile had new `zod` dep from plan 10-01)
- **Files modified:** `pnpm-lock.yaml` (updated with zod@^4.4.3), `node_modules/` directories
- **Verification:** `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` ran successfully
- **Committed in:** `pnpm-lock.yaml` not committed separately (committed with task changes)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking environment setup)
**Impact on plan:** Both were worktree environment setup issues, not code issues. No scope creep. All planned code changes executed exactly as specified.

## Issues Encountered

- Bun test silently hangs (exit code 1, no output) when `DATABASE_URL` env var is unset and `process.exit(1)` is called in `_compileGraph()`. Root cause: bun's `process.exit` in test context causes the test worker to terminate without printing results. Workaround: ensure `.env` is present in worktree.
- `brain-runner.integration.test.ts` fails with `db.insert().values().onConflictDoNothing is not a function` — this is a **pre-existing failure** that also exists in the main repo (confirmed). Not caused by this plan's changes.

## Known Stubs

None — no placeholder data or stub implementations in this plan's changes. Both tasks implement real logic.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes at trust boundaries introduced. The threat mitigations T-10-04, T-10-05, T-10-06 from the plan's threat model are all implemented:
- T-10-04: `BrainOutputSchema.parse()` validates structure before return
- T-10-05: null check + `BrainOutputValidationError` — never silent null return
- T-10-06: `rawOutput` in error context is internal only — must not be forwarded to client by handler.ts

## Next Phase Readiness

- `BrainStateAnnotation` and `BrainRunner.run()` are ready — Plan 03 (handler.ts + transport layer update) can proceed
- Brain apps (brain-sdr, brain-echo) will get `BrainOutputValidationError` at runtime until their graph nodes set `state.brainOutput` — this is intentional (fail-fast enforcement of the new contract)
- handler.ts still uses old `result.reply` — will be broken until Plan 03 updates it

---
*Phase: 10-output-parser-sdk*
*Completed: 2026-06-15*
