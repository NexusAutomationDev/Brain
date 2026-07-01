---
phase: 30-brain-suporte-docker
plan: 03
subsystem: infra
tags: [ci-cd, docker, e2e-validation, dockgate, brain-support]

# Dependency graph
requires:
  - phase: 30-brain-suporte-docker
    provides: "apps/brain-support/Dockerfile and docker-compose.yml (Plan 02) — validated end-to-end here"
provides:
  - ".github/workflows/publish-brain-support.yml — CI/CD publish pipeline for brain-support, mirroring publish-brain-sdr.yml"
  - "Proven, real end-to-end validation of the brain-support Docker image: build, migrate, /health, /api/v1/webhook round-trip"
affects: [brain-support-deployment, docker-images, ci-cd]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GitHub Actions publish workflow per Brain, structurally identical apart from APP_NAME/IMAGE_NAME/file/cache-scope — shared v*.*.* / v*.* tag trigger across all Brain workflows (D-11 revised: intentional simultaneous fan-out)"
    - "Ephemeral e2e validation via docker compose -p <isolated-project-name> --env-file <throwaway-file>, with host port shifted (5433) to avoid colliding with the compose file's internally-forced container port (5432)"

key-files:
  created:
    - .github/workflows/publish-brain-support.yml
  modified: []

key-decisions:
  - "Reused DOCKGATE_URL/DOCKGATE_UPLOAD_TOKEN secrets as-is (D-12) — no new GitHub secrets created"
  - "Ephemeral e2e env file set DATABASE_PORT=5433 (not 5432) so docker-compose's host port mapping (${DATABASE_PORT:-5433}:5432) does not collide with the host's production Postgres/PgBouncer already bound to 5432 — internal container-to-container traffic still resolves via the compose-forced DATABASE_HOST=postgres/DATABASE_PORT=5432 environment override on the brain-support service"
  - "LLM_PROVIDER/LLM_MODEL/API_KEY values copied from the main checkout's /root/Brain/.env (the executor worktree has no .env of its own) directly into the throwaway env file via command substitution, never echoed to stdout/logs"

requirements-completed: [SUP-06]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 30 Plan 03: Brain Suporte CI/CD Publish + Real E2E Validation Summary

**Created `publish-brain-support.yml` (mirrors `publish-brain-sdr.yml` exactly) and executed a real, live end-to-end round-trip proving the brain-support Docker image builds, migrates against an ephemeral isolated Postgres, serves `/health` as `ok`, and returns a valid `BrainOutput` from `/api/v1/webhook` using real LLM credentials — closing SUP-06.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-01T22:06:04Z
- **Tasks:** 2/2 completed
- **Files modified:** 1 created (Task 1); Task 2 was validation-only, no source changes

## Accomplishments

- `.github/workflows/publish-brain-support.yml` created, structurally identical to `publish-brain-sdr.yml` apart from the four intentionally-changed fields (`APP_NAME`, `IMAGE_NAME`, `file`, cache `scope`) — confirmed via `diff` after filtering name-only lines
- Same tag trigger pattern (`v*.*.*` / `v*.*`) as brain-sdr, per D-11 revised (intentional simultaneous fan-out on tag push)
- Real `docker build -f apps/brain-support/Dockerfile . -t brain-support` executed and completed successfully (image `brain-support:latest`, `sha256:66e69b96f90a...`, 441MB)
- Real ephemeral, isolated stack booted via `docker compose -f apps/brain-support/docker-compose.yml -p brain-support-e2e --env-file /tmp/brain-support-e2e.env up -d`: both `postgres` (healthy) and `brain-support` (up) confirmed via `docker compose -p brain-support-e2e ps`
- Migrations confirmed applied in container logs: `[migrate] Row-lock adquirido — iniciando migrations` → `[migrate] Migrations concluídas com sucesso` → `BrainRunner initialized`
- `GET /health` returned `{"status":"ok","checks":{"db":"connected","transport":"connected"},"transport":{"type":"webhook","connected":true},...}`
- `POST /api/v1/webhook` with a real test message (`IDLead`, `Numero`, `Name`, `Message` fields per `BrainEventSchema`) returned HTTP 200 with valid `BrainOutput`: `{"status":"ok","fullResponse":"Olá! Vou transferir você para um de nossos atendentes humanos...","responseMode":"text","tokenUsage":{"inputTokens":1469,"outputTokens":82,"totalTokens":1551}}` — using real OpenAI credentials from the repo's `.env`
- Full teardown executed: `docker compose -p brain-support-e2e down -v` removed both containers, the network, and the named volume; throwaway env files (`/tmp/brain-support-e2e.env` and `apps/brain-support/.env`) deleted; test image `brain-support:latest` removed
- Confirmed zero residual trace: `docker ps -a` shows no `brain-support-e2e-*` containers, `docker volume ls` shows no related volumes, and the host's production `db_postgres` container (`d510a9ef2a50`) remained `Up` with the same container ID throughout, never touched

## Actual Command Outputs (proof of SUP-06 closure)

**Build:**
```
$ docker build -f apps/brain-support/Dockerfile . -t brain-support
...
#55 exporting to image
#55 writing image sha256:66e69b96f90a620dca6b6cb16802469616ca4df2c02c330792f0710ceeda717c done
#55 naming to docker.io/library/brain-support done
#55 DONE 10.3s
```
Exit code: 0. `docker images brain-support` confirmed: `brain-support:latest 66e69b96f90a 441MB`.

**Compose up (both services healthy/up):**
```
$ docker compose -p brain-support-e2e ps
NAME                                 IMAGE                    STATUS
brain-support-e2e-brain-support-1    brain-support:latest     Up 10 seconds
brain-support-e2e-postgres-1         pgvector/pgvector:pg14   Up 16 seconds (healthy)
```

**Migration + init logs:**
```
brain-support-1 | Created new pool for tenant brain_support_e2e_test
brain-support-1 | {"level":"info",...,"msg":"BrainRunner initializing"}
brain-support-1 | [migrate] Row-lock adquirido — iniciando migrations
brain-support-1 | [migrate] Migrations concluídas com sucesso
brain-support-1 | {"level":"info",...,"msg":"Migrations completed"}
brain-support-1 | {"level":"info",...,"msg":"BrainRunner initialized"}
brain-support-1 | {"level":"info",...,"port":3002,"msg":"brain-support server listening"}
```

**GET /health:**
```
$ curl -sf http://localhost:3002/health
{"status":"ok","checks":{"db":"connected","transport":"connected"},"transport":{"type":"webhook","connected":true},"version":"unknown","timestamp":"2026-07-01T22:04:59.919Z"}
```

**POST /api/v1/webhook:**
```
$ curl -sf -X POST http://localhost:3002/api/v1/webhook \
  -H "Authorization: Bearer e2e-test-token" -H "Content-Type: application/json" \
  -d '{"IDLead":"e2e-test-lead-001","Numero":"5511999999999","Name":"Teste E2E Phase 30","Message":"Olá, preciso de ajuda com meu pedido"}'
{"status":"ok","fullResponse":"Olá! Vou transferir você para um de nossos atendentes humanos que poderá ajudar com seu pedido. Um momento, por favor.","responseMode":"text","tokenUsage":{"inputTokens":1469,"outputTokens":82,"totalTokens":1551}}
HTTP_STATUS:200
```

**Teardown confirmation:**
```
$ docker compose -f apps/brain-support/docker-compose.yml -p brain-support-e2e down -v
 Container brain-support-e2e-brain-support-1 Removed
 Container brain-support-e2e-postgres-1 Removed
 Volume brain-support-e2e_brain_support_pgdata Removed
 Network brain-support-e2e_default Removed

$ docker ps -a --filter "name=brain-support-e2e" --format '{{.Names}}'
(empty)

$ docker volume ls --filter "name=brain-support-e2e" --format '{{.Name}}'
(empty)

$ docker ps --filter "name=db_postgres" --format '{{.Names}}\t{{.ID}}\t{{.Status}}'
db_postgres.1.j3aoq5f4m1b2jpbhd8pzh830f  d510a9ef2a50  Up 2 days
```
Same container ID (`d510a9ef2a50`) as observed before the task started — confirmed zero impact on host production infrastructure.

## Task Commits

1. **Task 1: Create .github/workflows/publish-brain-support.yml** - `56f1608` (feat)
2. **Task 2: Real e2e validation round-trip** - no commit (validation-only, no source files modified; Dockerfile/docker-compose.yml from Plan 02 used unchanged)

_Note: no plan-metadata commit made here per orchestrator instructions — STATE.md/ROADMAP.md updates are owned by the orchestrator after all wave agents complete._

## Files Created/Modified

- `.github/workflows/publish-brain-support.yml` - CI/CD publish workflow, structurally identical to `publish-brain-sdr.yml` (same tag trigger, same DockGate publish sequence via existing secrets), only `APP_NAME`, `IMAGE_NAME`, `file: apps/brain-support/Dockerfile`, and cache `scope=brain-support` changed

## Decisions Made

- Kept the shared `v*.*.*` / `v*.*` tag trigger identical to brain-sdr's, per the phase's revised D-11 decision (both workflows intentionally fire on the same tag push)
- Did not create new GitHub secrets — reused `DOCKGATE_URL`/`DOCKGATE_UPLOAD_TOKEN` as-is (D-12)
- For the e2e validation, set the throwaway env file's `DATABASE_PORT=5433` (not `5432`) so the compose file's host port mapping (`${DATABASE_PORT:-5433}:5432` on the `postgres` service) would not attempt to bind the host's already-occupied `5432` port (bound by the host's production Postgres/PgBouncer stack) — the brain-support container's actual internal connection still uses `postgres:5432` via the compose file's own `environment:` override, unaffected by this env var
- Copied `LLM_PROVIDER`/`LLM_MODEL`/`API_KEY` values from `/root/Brain/.env` (main checkout) rather than the worktree's own `.env` — the worktree has no `.env` of its own (gitignored, not present in this isolated agent worktree) — values were read via `grep`+`cut` and written directly to the throwaway file without ever being echoed to stdout/logs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree branch was missing Plan 02's Dockerfile/docker-compose.yml at task start**
- **Found during:** Pre-task branch verification
- **Issue:** `git merge-base HEAD <target>` trivially reported HEAD as an ancestor of the target merge commit (since HEAD predates it), but the working tree at HEAD did not yet contain Plan 02's `apps/brain-support/Dockerfile` and `docker-compose.yml` — the target merge commit (`0d66469`) merges in Plan 02's branch (`7337852`) on top of the current HEAD (`baa5260`). A literal ancestor check passed without catching that the working tree itself needed to be advanced.
- **Fix:** Ran `git reset --soft 0d66469...` to move HEAD to the target commit, then `git checkout HEAD -- .` to sync the working tree/index (a plain `--soft` reset left stale index entries showing spurious deletions). Verified `apps/brain-support/Dockerfile` and `docker-compose.yml` present and `git status --short` clean afterward.
- **Files affected:** none (working tree sync only, no content changes)
- **Verification:** `git log --oneline -3` confirmed HEAD at `0d66469`; `ls apps/brain-support/` confirmed `Dockerfile` and `docker-compose.yml` present; `git status --short` empty

**2. [Rule 3 - Blocking] docker compose up failed: host port 5432 already in use**
- **Found during:** Task 2, Step 3 (boot ephemeral stack)
- **Issue:** Setting `DATABASE_PORT=5432` in the throwaway `--env-file` (per the plan's literal instruction) caused `docker-compose.yml`'s `postgres` service port mapping `"${DATABASE_PORT:-5433}:5432"` to attempt binding host port `5432`, which was already occupied by the host's production Postgres/PgBouncer stack — Docker returned `failed to bind host port 0.0.0.0:5432/tcp: address already in use`.
- **Fix:** Torn down the partially-created stack (`docker compose -p brain-support-e2e down -v`), then changed the throwaway env file's `DATABASE_PORT` to `5433` (matching the compose file's own documented default for the host-side mapping), leaving `DATABASE_URL` pointed at the in-network `postgres:5432` address (resolved inside the Docker network, unaffected by the host port change) and relying on the compose file's own `environment:` block (`DATABASE_HOST: postgres`, `DATABASE_PORT: 5432`) to force the correct internal container-to-container connection regardless of the `--env-file` value.
- **Files affected:** none (env file only, `/tmp/brain-support-e2e.env` and `apps/brain-support/.env`, both throwaway/gitignored)
- **Verification:** Re-ran `docker compose ... up -d`; both services reached `Up`/`healthy`; confirmed port `5433` was free via `ss -ltn` before retrying

**3. [Rule 3 - Blocking] docker compose up failed: apps/brain-support/.env not found**
- **Found during:** Task 2, Step 3 (first attempt, before the port fix)
- **Issue:** `docker-compose.yml`'s `brain-support` service declares `env_file: .env` (relative to the compose file's directory, i.e. `apps/brain-support/.env`), distinct from the `--env-file` flag used for variable substitution within the compose file itself. No such file existed in this worktree.
- **Fix:** Copied the throwaway env content to `apps/brain-support/.env` as well (confirmed gitignored via `.gitignore`'s `.env` / `.env.*` / `!.env.example` rules and `git status --short` showing nothing), then removed it during teardown.
- **Files affected:** none tracked by git (gitignored, untracked local file only)
- **Verification:** `git status --short apps/brain-support/.env` empty before and after; file confirmed absent post-teardown

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking issues preventing task completion; no scope creep beyond what Task 2's validation sequence required)
**Impact on plan:** All three were operational/environmental fixes needed to execute the plan's own literal validation sequence in this specific host environment (worktree branch state, host port collision, gitignored env file convention); no architectural or behavioral changes to any source file.

## Issues Encountered

None beyond the three auto-fixed items above.

## User Setup Required

None — `DOCKGATE_URL`/`DOCKGATE_UPLOAD_TOKEN` secrets already exist in the repo (reused from `publish-brain-sdr.yml`, no new secrets needed). The new workflow will fire automatically on the next `v*.*.*` tag push, exactly as `publish-brain-sdr.yml` already does.

## Next Phase Readiness

- SUP-06 fully closed: Dockerfile proven to build and run end-to-end (not just "exists"), CI/CD publish pipeline in place and ready to fire on the next tag push
- Phase 30 (Brain Suporte Docker) complete — all three roadmap success criteria for SUP-06 satisfied (build succeeds, container migrates + `/health` ok, container processes a real webhook message and returns valid `BrainOutput`)
- No blockers for milestone completion

---
*Phase: 30-brain-suporte-docker*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: .github/workflows/publish-brain-support.yml
- FOUND: .planning/phases/30-brain-suporte-docker/30-03-SUMMARY.md
- FOUND: commit 56f1608
