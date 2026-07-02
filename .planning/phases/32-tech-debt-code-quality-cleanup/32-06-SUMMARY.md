---
phase: 32-tech-debt-code-quality-cleanup
plan: 06
subsystem: testing
tags: [bun-test, embeddings, ambient-env, test-isolation]

# Dependency graph
requires:
  - phase: 32-tech-debt-code-quality-cleanup (plan 01)
    provides: D-13 mock.module cross-pollution fix (real createEmbeddingProvider() left unmocked in brain-runner.test.ts)
provides:
  - "brain-runner.test.ts deterministic regardless of ambient EMBEDDING_DIMENSIONS env value"
  - "factory.test.ts's Gemini-resolving tests deterministic regardless of ambient EMBEDDING_DIMENSIONS env value"
  - "TECH-06 marked complete in REQUIREMENTS.md — Phase 32 fully closed (6/6 plans, 0 open gaps)"
affects: [testing, ci-regression-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level process.env override + afterAll restore (prevents test-file env mutation leaking into other files sharing the same bun test worker process)"

key-files:
  created: []
  modified:
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/embeddings/src/__tests__/unit/factory.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Pinned EMBEDDING_DIMENSIONS=1536 in brain-runner.test.ts at module level (before BrainRunner import), matching makeMockSql()'s hardcoded value, with afterAll restore to prevent process.env leakage into other files in the same bun test worker"
  - "Extended factory.test.ts's existing ENV_KEYS reset/restore pattern to include EMBEDDING_DIMENSIONS after discovering its Gemini-resolving tests were also broken by this repo's real .env.test — same root-cause class as Gap 1, but not anticipated by the plan's file scope"

patterns-established:
  - "Any test file that sets process.env at module scope (not inside beforeEach/afterEach) must save the original value and restore it via a file-level afterAll — mock.module() is already file-scoped, but raw process.env writes are not"

requirements-completed: [TECH-06]

# Metrics
duration: 15min
completed: 2026-07-02
---

# Phase 32 Plan 06: Close Verification Gaps Summary

**Pinned EMBEDDING_DIMENSIONS in both brain-runner.test.ts and factory.test.ts to eliminate ambient .env.test drift, closing Phase 32's last 2 verification gaps.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-02T14:50:00Z (approx)
- **Completed:** 2026-07-02T14:52:38Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `brain-runner.test.ts` now passes deterministically (38 pass, 0 fail) in this repo's real environment (`.env.test` sets `EMBEDDING_DIMENSIONS=128`), instead of silently crashing via an unguarded `process.exit(1)` inside `runner.ts`'s dimension fail-fast check
- Discovered and fixed a second, previously-undocumented instance of the same ambient-env-drift bug class in `factory.test.ts` (its Gemini-resolving tests failed even in isolation, independent of this plan's changes — confirmed via `git stash` bisection)
- Combined regression run (`brain-runner.test.ts` + `factory.test.ts`) now shows 49 pass, 0 fail, in both file orderings — proving Plan 01's D-13 mock.module cross-pollution fix still holds
- `REQUIREMENTS.md` now shows TECH-06 as `[x]` complete in both the checklist and Traceability table, closing Phase 32 (6/6 plans, 0 open gaps)

## Task Commits

Each task was committed atomically:

1. **Task 1: Make brain-runner.test.ts independent of ambient EMBEDDING_DIMENSIONS env value** - `bf87678` (fix)
2. **Task 2: Mark TECH-06 complete in REQUIREMENTS.md** - `0050bf1` (docs)

**Plan metadata:** (this SUMMARY commit, to follow)

## Files Created/Modified
- `packages/core/src/runner/__tests__/brain-runner.test.ts` - Pinned `process.env.EMBEDDING_DIMENSIONS = "1536"` before the `BrainRunner` import (module-level, mirroring the existing `MIGRATIONS_FOLDER`/`DATABASE_URL` override pattern), with a save/restore via `afterAll` to prevent the raw `process.env` mutation from leaking into other test files sharing the same `bun test` worker process; also updated the stale D-13 rationale comment to reflect the new pinned value
- `packages/embeddings/src/__tests__/unit/factory.test.ts` - Added `EMBEDDING_DIMENSIONS` to the file's existing `ENV_KEYS` reset/restore array (alongside `EMBEDDING_PROVIDER`/`LLM_PROVIDER`), fixing a pre-existing failure in Test 1 and Test 3 (both resolve to the Gemini provider, which fail-fast rejects any `EMBEDDING_DIMENSIONS !== 3072`)
- `.planning/REQUIREMENTS.md` - TECH-06 checkbox flipped to `[x]` and Traceability table row changed from `Pending` to `Complete`

## Decisions Made
- Restore ambient env via `afterAll` rather than leaving the module-level override permanent — this is necessary because `process.env` mutations (unlike `mock.module()`) are not file-scoped in `bun test`'s shared worker process, and leaving the override unrestored would have broken `factory.test.ts` when run after `brain-runner.test.ts` in the same process
- Extended the fix to `factory.test.ts` even though it was outside the plan's `files_modified` frontmatter — this was a blocking issue for the plan's own explicit acceptance criteria ("combined run shows 0 failures", "factory.test.ts in isolation still passes unchanged"), and `git stash` bisection confirmed the failure pre-existed this plan's changes and shares the exact same root cause (ambient `.env.test` `EMBEDDING_DIMENSIONS=128` drift) that this plan already targets

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Rule 3 - Blocking] factory.test.ts's Gemini-resolving tests broken by the same ambient EMBEDDING_DIMENSIONS drift this plan targets**
- **Found during:** Task 1 verification (running the combined `brain-runner.test.ts` + `factory.test.ts` regression command specified in the plan's acceptance criteria)
- **Issue:** With this repo's real `.env.test` present (`EMBEDDING_DIMENSIONS=128`), `factory.test.ts`'s Test 1 and Test 3 (both resolve to the `gemini` provider) failed with `ConfigurationError: EMBEDDING_DIMENSIONS=128 is incompatible with Gemini`. Confirmed via `git stash` that this failure is pre-existing and independent of this plan's `brain-runner.test.ts` change — `factory.test.ts` run alone, on the unmodified baseline, already failed the same 2 tests. `factory.test.ts` only reset `EMBEDDING_PROVIDER`/`LLM_PROVIDER` per-test, never `EMBEDDING_DIMENSIONS`, so it silently inherited whatever the ambient `.env.test` set.
- **Fix:** Added `EMBEDDING_DIMENSIONS` to `factory.test.ts`'s existing `ENV_KEYS` array, so it is deleted in `beforeEach` and restored in `afterAll` — the exact same established pattern already used for `EMBEDDING_PROVIDER`/`LLM_PROVIDER` in that file.
- **Files modified:** `packages/embeddings/src/__tests__/unit/factory.test.ts`
- **Verification:** `bun test packages/embeddings/src/__tests__/unit/factory.test.ts` (isolated): 11 pass, 0 fail. Combined run with `brain-runner.test.ts` in both file orderings: 49 pass, 0 fail.
- **Committed in:** `bf87678` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/blocking, same root-cause class as this plan's primary fix)
**Impact on plan:** Necessary to satisfy the plan's own explicit acceptance criteria for the combined regression run. No scope creep beyond the ambient-env-drift bug class this plan already targets; no architectural change.

## Issues Encountered
- The worktree had no `node_modules` and no local `.env.test` (both gitignored, not present in a fresh worktree checkout). Ran `bun install` (regenerated `bun.lock` from `pnpm-lock.yaml`, both gitignored) and copied `.env.test` from the main checkout to reproduce this repo's actual environment (`EMBEDDING_DIMENSIONS=128`) for verification, matching the plan's explicit instruction to verify "by actually executing the command, not by reading the diff."

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 32 (tech-debt-code-quality-cleanup) is now fully closed: 6/6 plans complete, 0 open gaps in `32-VERIFICATION.md`
- `brain-runner.test.ts` and `factory.test.ts` are both now resilient to ambient `EMBEDDING_DIMENSIONS` drift from any local/CI `.env.test`, closing this specific class of cross-environment test fragility for the embeddings/runner test suite

---
*Phase: 32-tech-debt-code-quality-cleanup*
*Completed: 2026-07-02*

## Self-Check: PASSED

- FOUND: packages/core/src/runner/__tests__/brain-runner.test.ts
- FOUND: packages/embeddings/src/__tests__/unit/factory.test.ts
- FOUND: .planning/REQUIREMENTS.md
- FOUND: .planning/phases/32-tech-debt-code-quality-cleanup/32-06-SUMMARY.md
- FOUND commit: bf87678
- FOUND commit: 0050bf1
