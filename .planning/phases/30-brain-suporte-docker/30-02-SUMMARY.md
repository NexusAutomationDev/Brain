---
phase: 30-brain-suporte-docker
plan: 02
subsystem: infra
tags: [docker, docker-compose, pgvector, bun, multi-stage-build, brain-support]

# Dependency graph
requires:
  - phase: 30-brain-suporte-docker
    provides: "brain-sdr Dockerfile embeddings-inclusion fix pattern (Plan 01) used as the corrected reference adapted here"
provides:
  - "apps/brain-support/Dockerfile — independent multi-stage Docker build for brain-support, including packages/embeddings from the start"
  - "apps/brain-support/docker-compose.yml — local dev/test convenience stack (pgvector Postgres + brain-support)"
affects: [30-03, brain-support-deployment, docker-images]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-stage Dockerfile: node:22-slim builder (pnpm/tsc) + oven/bun:1 runner, one COPY per workspace package (dist + package.json + node_modules)"
    - "Embeddings package built before core in the builder RUN sequence (core depends on embeddings) — corrected ordering vs. the original brain-sdr Dockerfile"
    - "docker-compose bundling a disposable pgvector/pgvector Postgres service (health-gated depends_on) with the Brain service for local e2e testing"

key-files:
  created:
    - apps/brain-support/Dockerfile
    - apps/brain-support/docker-compose.yml
  modified: []

key-decisions:
  - "Default PORT=3002 in the Dockerfile matches .env.example, distinct from brain-sdr's 3000, avoiding port collision if both run on the same host"
  - "docker-compose Postgres service published on host port 5433 (not 5432) to avoid colliding with any host-level production Postgres"
  - "brain-support service's DATABASE_HOST/DATABASE_PORT are forced to postgres/5432 inside the compose environment block, overriding whatever .env declares, so the compose stack is self-contained"
  - "Named volume brain_support_pgdata is compose-stack-local; docker compose down -v fully discards it, keeping it isolated from any production volume"

patterns-established:
  - "Any future Brain's Dockerfile should build packages/embeddings before packages/core in the builder stage, matching this corrected ordering"

requirements-completed: [SUP-06]

# Metrics
duration: 15min
completed: 2026-07-01
---

# Phase 30 Plan 02: Brain Suporte Dockerfile + Compose Summary

**Independent multi-stage Dockerfile for brain-support (node:22-slim builder + oven/bun:1 non-root runner) with packages/embeddings correctly built before packages/core, plus a docker-compose.yml bundling an isolated pgvector Postgres service for local dev/test.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-01T21:50:51Z
- **Tasks:** 2/2 completed
- **Files modified:** 2 created

## Accomplishments
- `apps/brain-support/Dockerfile` builds successfully end-to-end (`docker build -f apps/brain-support/Dockerfile . -t brain-support` exits 0) and includes `packages/embeddings` from the start, avoiding the gap that had to be retroactively patched on brain-sdr
- Final image runs as non-root user `bun` (verified via `docker inspect --format '{{.Config.User}}'` → `bun`)
- `apps/brain-support/docker-compose.yml` provides a self-contained local stack: `pgvector/pgvector:pg14` Postgres (health-gated) + `brain-support`, isolated from production infra via a dedicated named volume and non-default host port
- Zero cross-references to `brain-sdr`/`brain-echo` in either file (`grep -ic "brain-sdr\|brain-echo"` → `0`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write apps/brain-support/Dockerfile** - `4375952` (feat)
2. **Task 2: Write apps/brain-support/docker-compose.yml** - `0deb195` (feat)

_Note: no plan-metadata commit made per orchestrator instructions — STATE.md/ROADMAP.md updates are owned by the orchestrator after all wave agents complete._

## Files Created/Modified
- `apps/brain-support/Dockerfile` - Multi-stage build (builder: node:22-slim + pnpm, compiles shared→database→observability→ai→transport→memory→embeddings→core→@brain-app/support in dependency order; runner: oven/bun:1, copies dist+package.json+node_modules per workspace package plus migrations, runs as `USER bun`, default `PORT=3002`)
- `apps/brain-support/docker-compose.yml` - Local dev/test stack: `postgres` service (`pgvector/pgvector:pg14`, host port `5433` default, named volume `brain_support_pgdata`, `pg_isready` healthcheck) + `brain-support` service (builds from the Dockerfile, `depends_on: postgres: condition: service_healthy`, `env_file: .env`, `DATABASE_HOST`/`DATABASE_PORT` forced to the in-network `postgres:5432`)

## Decisions Made
- Embeddings build step positioned after `memory`, before `core` in the Dockerfile builder stage — required because `@brain-pkg/core` depends on `@brain-pkg/embeddings`; this is the corrected ordering that Plan 01 applied retroactively to brain-sdr, applied here from the start
- Default `PORT=3002` chosen (not 3000, brain-sdr's default) so both Brains can run simultaneously on the same host without a port clash
- docker-compose Postgres published on host port `5433` (not the standard `5432`) to avoid any collision with a host-level Postgres instance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed accidental "brain-sdr" text match and duplicate "USER bun" grep match from Dockerfile comments**
- **Found during:** Task 1 verification (acceptance criteria: `grep -ic "brain-sdr\|brain-echo"` must return `0`; `grep -c "USER bun"` must return exactly `1`)
- **Issue:** The initial Dockerfile draft included an explanatory comment referencing "mesmo padrão do brain-sdr" (a leftover phrase from the plan's own interface reference text) and a comment line containing the literal string "USER bun" immediately above the actual `USER bun` instruction, both of which caused the automated grep checks to fail their exact-count assertions
- **Fix:** Reworded the migrations comment to drop the "brain-sdr" mention, and simplified the USER instruction's preceding comment to avoid repeating the literal "USER bun" string
- **Files modified:** `apps/brain-support/Dockerfile`
- **Verification:** Re-ran all six grep-based acceptance criteria plus `docker build` — all pass; `docker inspect` confirms `USER=bun`
- **Committed in:** `4375952` (Task 1 commit — fixed before the task was committed, not a separate commit)

**2. [Rule 3 - Blocking] Created a local `.env` (gitignored) to satisfy `docker compose config` validation**
- **Found during:** Task 2 verification (acceptance criteria: `docker compose -f apps/brain-support/docker-compose.yml config` must exit 0)
- **Issue:** `docker-compose.yml` declares `env_file: .env` for the `brain-support` service (matching the existing `brain-echo` pattern), but no `.env` file exists in the repo (by design — `.env` is gitignored). `docker compose config` fails outright if the referenced `env_file` doesn't exist on disk, regardless of the YAML being otherwise valid. Confirmed this is a pre-existing pattern gap by reproducing the identical failure against `apps/brain-echo/docker-compose.yml` (which has the same `env_file: .env` reference and no committed `.env`), ruling out any defect introduced by this plan.
- **Fix:** Copied `apps/brain-support/.env.example` to `apps/brain-support/.env` locally (already covered by repo-root `.gitignore` rules `.env` / `.env.*` / `!.env.example`, confirmed untracked by `git status`) purely to run the validation command; this file is not committed and is expected to be created by any real user of this compose file per its own inline instructions
- **Files modified:** none tracked by git (local-only `.env`, gitignored)
- **Verification:** `docker compose -f apps/brain-support/docker-compose.yml config` exits 0 and produces the expected resolved service definitions
- **Committed in:** N/A (untracked, gitignored file — not part of any commit)

---

**Total deviations:** 2 auto-fixed (2 blocking — both fix-forward corrections needed to satisfy the plan's own automated acceptance criteria, no scope creep beyond the plan's stated files)
**Impact on plan:** Both deviations were required strictly to make the plan's own verification commands pass as written; no architectural or behavioral changes were introduced beyond what Tasks 1 and 2 specified.

## Issues Encountered
None beyond the two auto-fixed items above.

## User Setup Required
None - no external service configuration required. Local `docker compose up` usage requires the user to create their own `apps/brain-support/.env` from `.env.example` (already documented inline in the compose file's header comment), same as the existing `brain-echo` convention.

## Next Phase Readiness
- `apps/brain-support/Dockerfile` and `docker-compose.yml` are ready for the e2e validation planned in Plan 03 (build → ephemeral Postgres → brain-support → `/health` + `/api/v1/webhook` round-trip)
- No blockers identified for Plan 03

---
*Phase: 30-brain-suporte-docker*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: apps/brain-support/Dockerfile
- FOUND: apps/brain-support/docker-compose.yml
- FOUND: .planning/phases/30-brain-suporte-docker/30-02-SUMMARY.md
- FOUND: commit 4375952
- FOUND: commit 0deb195
