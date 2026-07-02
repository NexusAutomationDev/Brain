---
phase: 30-brain-suporte-docker
plan: 01
subsystem: infra
tags: [docker, dockerignore, brain-sdr, embeddings, pnpm, multi-stage-build]

# Dependency graph
requires:
  - phase: 28-embedding-sdk
    provides: packages/embeddings (@brain-pkg/embeddings) consumed by @brain-pkg/core and apps/brain-sdr since Phase 28
provides:
  - Root .dockerignore covering all three Brains (brain-sdr, brain-echo, brain-support)
  - apps/brain-sdr/Dockerfile fixed to build+copy packages/embeddings into the runner stage
affects: [30-02-brain-suporte-docker, 30-03-brain-suporte-docker, future Dockerfile authors for any Brain]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Root-level .dockerignore shared across all apps/<brain>/Dockerfile builds (single build context = repo root)"
    - "Multi-stage Dockerfile package build order follows dependency graph: shared -> database -> observability -> ai -> transport -> memory -> embeddings -> core -> app"

key-files:
  created:
    - .dockerignore
  modified:
    - apps/brain-sdr/Dockerfile

key-decisions:
  - "packages/embeddings builds after memory and before core in the Dockerfile RUN sequence, since @brain-pkg/core depends on @brain-pkg/embeddings"
  - "Runner stage COPY blocks for embeddings inserted alphabetically between database and memory, matching existing convention for the other 6 packages"

patterns-established:
  - "Dockerfile package COPY blocks (dist/package.json and node_modules) kept in strict alphabetical order for maintainability"

requirements-completed: [SUP-06]

# Metrics
duration: 12min
completed: 2026-07-01
---

# Phase 30 Plan 01: Root .dockerignore + brain-sdr embeddings Dockerfile fix Summary

**Root .dockerignore for all Brains plus a corrected apps/brain-sdr/Dockerfile that now builds and copies packages/embeddings, fixing a `Cannot find module '@brain-pkg/embeddings'` production crash.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-01T21:XX:XXZ
- **Completed:** 2026-07-01T21:XX:XXZ
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created root `.dockerignore` excluding `node_modules`, `.git`, `.env*` (with `.env.example` re-included), and stale `dist`/`.tsbuildinfo`/`.turbo` host artifacts from every `docker build -f apps/<brain>/Dockerfile .` build context
- Fixed `apps/brain-sdr/Dockerfile`: added `RUN pnpm --filter @brain-pkg/embeddings build` before the `core` build step, and added the corresponding `COPY --from=builder` lines for `dist/`, `package.json`, and `node_modules` of `packages/embeddings` in the runner stage
- Verified the fix end-to-end: `docker build -f apps/brain-sdr/Dockerfile . -t brain-sdr-test` completed with exit code 0, and inside the built image `require.resolve("@brain-pkg/embeddings")` resolves to `/app/packages/embeddings/dist/index.js`; a dynamic `import("@brain-pkg/embeddings")` succeeds and exposes `GeminiEmbeddingProvider`, `OpenAIEmbeddingProvider`, `createEmbeddingProvider`, `resolveEmbeddingProviderName`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create root .dockerignore for all Brains** - `6417299` (security)
2. **Task 2: Fix packages/embeddings gap in apps/brain-sdr/Dockerfile** - `9673b2e` (fix)

_Note: no plan-metadata commit — orchestrator owns STATE.md/ROADMAP.md updates for this wave._

## Files Created/Modified
- `.dockerignore` - Root-level Docker build context exclusions shared by all three Brains (brain-sdr, brain-echo, brain-support)
- `apps/brain-sdr/Dockerfile` - Added `packages/embeddings` build step (before `core`) and runner-stage COPY lines for its `dist/`, `package.json`, `node_modules`

## Decisions Made
- Followed the plan's exact alphabetical insertion point for embeddings COPY blocks (between `database` and `memory`) to preserve the existing maintainability convention in the file
- Placed the embeddings build RUN line after `memory` and before `core`, matching the plan's dependency-order rationale (`core` depends on `embeddings`, no ordering constraint versus `memory`)

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their acceptance criteria without requiring any auto-fixes (Rules 1-3) or architectural questions (Rule 4).

## Issues Encountered

During verification, the first few `docker run --rm brain-sdr-test bun -e "..."` invocations produced no stdout despite exit code 0. Investigation showed `require.resolve()` fails silently from Bun's `[eval]` synthetic module context regardless of package (reproduced identically with the already-working `@brain-pkg/core`), because `[eval]` has no real directory for Node-style module resolution to walk up from. This is a Bun eval-context quirk, not a bug in the Dockerfile fix. Resolved by running the check with `cd /app/apps/brain-sdr &&` first, matching how the real app resolves modules at runtime — confirmed both `@brain-pkg/core` and `@brain-pkg/embeddings` resolve correctly from there, and confirmed `@brain-pkg/embeddings` fully imports with all expected exports.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`apps/brain-sdr/Dockerfile` now builds cleanly and the `packages/embeddings` gap (production risk D-03) is closed, alongside the new root `.dockerignore` (security/hygiene gap D-06). Plan 30-02 (brain-support Dockerfile) can now be authored against a Dockerfile pattern in `apps/brain-sdr` that already includes `embeddings` in the correct build order and runner COPY blocks, so brain-support will inherit the fix rather than propagate the bug. No blockers.

---
*Phase: 30-brain-suporte-docker*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: .dockerignore
- FOUND: apps/brain-sdr/Dockerfile
- FOUND: .planning/phases/30-brain-suporte-docker/30-01-SUMMARY.md
- FOUND: commit 6417299 (Task 1 - .dockerignore)
- FOUND: commit 9673b2e (Task 2 - embeddings Dockerfile fix)
