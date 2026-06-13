---
phase: 02-domain-packages
plan: "08"
subsystem: database
tags: [drizzle-orm, postgres, langchain, pnpm, memory, dependencies]

# Dependency graph
requires:
  - phase: 02-domain-packages
    provides: "packages/memory source files importing drizzle-orm and @langchain/langgraph-checkpoint-postgres"
provides:
  - "packages/memory/package.json with correct direct dep declarations (drizzle-orm, postgres, @langchain/core, @langchain/langgraph-checkpoint-postgres)"
  - "Memory package importable — drizzle-orm module resolution no longer fails"
  - "bun test packages/memory exits 0 with no failures"
affects: [02-09, verification, SC-2]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - packages/memory/package.json
    - pnpm-lock.yaml

key-decisions:
  - "@langchain/core added to devDependencies (not just dependencies) — FakeEmbeddings is test-only utility"
  - "drizzle-orm version pinned to ^0.45.2 matching packages/database to avoid version divergence in monorepo"

patterns-established: []

requirements-completed: [MEM-01, MEM-02, MEM-03, MEM-04]

# Metrics
duration: 10min
completed: 2026-06-12
---

# Phase 02 Plan 08: Gap Closure 1 — Memory Package Missing Deps Summary

**drizzle-orm, postgres, and @langchain/core declared as direct deps in packages/memory/package.json, unblocking SC-2 memory integration tests**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-12T02:38:00Z
- **Completed:** 2026-06-12T02:48:13Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `drizzle-orm ^0.45.2` to dependencies (long-term.ts and semantic.ts import directly)
- Added `postgres ^3.4.9` to dependencies (manager.ts and tests use postgres driver)
- Added `@langchain/langgraph-checkpoint-postgres ^1.0.3` to devDependencies (manager.test.ts)
- Added `@langchain/core ^1.1.48` to devDependencies (FakeEmbeddings in semantic.test.ts and manager.test.ts)
- `pnpm install` linked all new deps successfully in worktree node_modules
- `bun test packages/memory`: 0 failures, 18 skipped (no TEST_DATABASE_URL — expected behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add missing direct dependencies to packages/memory/package.json** - `3d4fa4f` (feat)

## Files Created/Modified
- `packages/memory/package.json` - Added drizzle-orm, postgres, @langchain/langgraph-checkpoint-postgres, @langchain/core
- `pnpm-lock.yaml` - Updated lockfile reflecting new deps in memory package

## Decisions Made
- `@langchain/core` added to devDependencies alongside `@langchain/langgraph-checkpoint-postgres` — both are test-only, but `@langchain/core` was missing and caused `Cannot find module '@langchain/core/utils/testing'` errors
- Version strings match existing monorepo declarations (drizzle-orm from packages/database, @langchain/core and checkpoint-postgres from packages/ai) to avoid duplicate or conflicting versions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added @langchain/core to devDependencies**
- **Found during:** Task 1 (after adding the 3 planned deps and running tests)
- **Issue:** Plan specified 3 deps to add (drizzle-orm, postgres, @langchain/langgraph-checkpoint-postgres), but tests also import `FakeEmbeddings` from `@langchain/core/utils/testing` — omitting it causes `Cannot find module '@langchain/core/utils/testing'` errors in semantic.test.ts and manager.test.ts
- **Fix:** Added `@langchain/core ^1.1.48` to devDependencies (same version as packages/ai), re-ran pnpm install
- **Files modified:** packages/memory/package.json, pnpm-lock.yaml
- **Verification:** bun test packages/memory — 0 failures after fix
- **Committed in:** `3d4fa4f` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical devDependency)
**Impact on plan:** Required for tests to pass. No scope creep — stays within memory package manifest fix.

## Issues Encountered
- pnpm install with `--filter @brain-pkg/memory` reported "Already up to date" but deps were NOT linked in the worktree. Had to run `pnpm install` without filter to properly populate node_modules in the worktree context. Root cause: worktree had no node_modules at all — filter skipped the install since lockfile was already satisfied in the parent repo.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SC-2 is unblocked: memory package is importable, all 18 tests skip cleanly waiting for TEST_DATABASE_URL
- When TEST_DATABASE_URL is set (integration environment), all 18 tests should execute and pass
- Plan 02-09 (next gap closure) can proceed independently

---
*Phase: 02-domain-packages*
*Completed: 2026-06-12*
