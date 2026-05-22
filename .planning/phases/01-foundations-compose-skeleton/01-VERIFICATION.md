---
phase: 01-foundations-compose-skeleton
verified: 2026-05-22T00:00:00Z
status: gaps_found
score: 18/23 must-haves verified
overrides_applied: 0
gaps:
  - truth: "`docker compose up` on a fresh checkout brings the full 10-service stack to service_healthy deterministically; lite also reaches healthy"
    status: failed
    reason: "Brain service healthcheck in both compose files probes a non-existent route (`/health`) — FastAPI only exposes `/healthz` and `/readyz`. wget will always return 404 -> non-zero, so Brain can never reach `service_healthy`. This deterministically breaks smoke-up.sh polling (exit 3) and SC-1 of the ROADMAP."
    artifacts:
      - path: "docker-compose.yml"
        issue: "Line 126: `wget -qO- http://localhost:8000/health || exit 1` — endpoint /health does not exist; only /healthz is registered in src/brain/api/health.py"
      - path: "docker-compose.lite.yml"
        issue: "Line 112: same `/health` typo — must be `/healthz`"
    missing:
      - "Change compose brain healthcheck `test` to `wget -qO- http://localhost:8000/healthz || exit 1` in both docker-compose.yml and docker-compose.lite.yml"
  - truth: "SIGTERM during a slow request drains the request within BRAIN_SHUTDOWN__GRACE_SECONDS (default 30s)"
    status: failed
    reason: "Prod Dockerfile CMD wraps uvicorn in `sh -c \"uvicorn ...\"` WITHOUT `exec`. PID 1 becomes /bin/sh; POSIX sh does not forward signals to its children by default, so SIGTERM is delivered to sh and uvicorn's graceful-shutdown handler never runs. The kernel kills the process group after Docker's stop grace. This silently defeats FOUND-09 / D-13 — the very contract the rest of Phase 1 was designed to honor. CR-01 in 01-REVIEW.md identified this; no fix shipped."
    artifacts:
      - path: "docker/Dockerfile"
        issue: "Line 95: `CMD [\"sh\", \"-c\", \"uvicorn brain.api.app:app ...\"]` — missing `exec` before `uvicorn`."
    missing:
      - "Change CMD to: `CMD [\"sh\", \"-c\", \"exec uvicorn brain.api.app:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown ${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}\"]`"
      - "Add a regression check in scripts/smoke-up.sh that asserts `docker exec ... ps -o pid,comm 1` shows `uvicorn` or `python`, NOT `sh`"
  - truth: "Smoke-up.sh drain assertion honors `BRAIN_SHUTDOWN__GRACE_SECONDS` env var (the canonical pydantic-settings nested key)"
    status: failed
    reason: "scripts/smoke-up.sh line 140 reads `BRAIN_SHUTDOWN_GRACE_SECONDS` (SINGLE underscore). Every other component in the project uses `BRAIN_SHUTDOWN__GRACE_SECONDS` (double underscore — the `env_nested_delimiter='__'` convention). The smoke script always falls back to 30s and is silently insensitive to developer overrides. WR-02 in 01-REVIEW.md identified this; not fixed."
    artifacts:
      - path: "scripts/smoke-up.sh"
        issue: "Line 140: `DRAIN_GRACE=\"${BRAIN_SHUTDOWN_GRACE_SECONDS:-30}\"` — must be `${BRAIN_SHUTDOWN__GRACE_SECONDS:-30}`"
    missing:
      - "Rename env var read in line 140 to `BRAIN_SHUTDOWN__GRACE_SECONDS` (double underscore)"
  - truth: "Lifespan startup is exception-safe — partial-startup failure does not leak pool/rabbit/qdrant resources"
    status: partial
    reason: "Lifespan opens pool, then aio-pika robust connection, then constructs Qdrant client OUTSIDE any try/finally protection. If aio-pika.connect_robust raises (RabbitMQ unreachable), the already-opened psycopg pool is leaked. uvicorn refuses to bind the port (correct), but the resource-leak pattern is fragile — any future addition between resources will inherit the same bug. WR-01 in 01-REVIEW.md identified; not fixed."
    artifacts:
      - path: "src/brain/api/app.py"
        issue: "Lines 57-76: pool.open(), aio_pika.connect_robust(), AsyncQdrantClient() all execute before the try/yield/finally block. Only the yield is wrapped."
    missing:
      - "Wrap startup in `contextlib.AsyncExitStack` so each resource registers its cleanup immediately upon successful open"
  - truth: "build_langgraph_dsn preserves sibling -c directives in `options=...` (does not silently drop user GUCs)"
    status: failed
    reason: "src/brain/db/checkpointer.py lines 29-31: when `options=...` already contains the substring `search_path`, the function replaces the ENTIRE options string with `-csearch_path=langgraph`, discarding sibling directives like `-cstatement_timeout=5000`. The docstring promises only search_path replacement but the implementation drops everything else too. WR-04 in 01-REVIEW.md identified; not fixed."
    artifacts:
      - path: "src/brain/db/checkpointer.py"
        issue: "Lines 29-31: `if 'search_path' in options_existing: options_new = '-csearch_path=langgraph'` — should splice out only the existing -csearch_path token, then append the new one."
    missing:
      - "Splice out only `-csearch_path=...` tokens (regex) and append `-csearch_path=langgraph`; add a unit test for `?options=-cstatement_timeout%3D5000 -csearch_path%3Dfoo`"
human_verification:
  - test: "Run `bash scripts/smoke-up.sh lite` end-to-end on a Docker host"
    expected: "Stack reaches healthy within 180s; /healthz and /readyz return 200; drain assertion passes (returns 200 across SIGTERM)"
    why_human: "Requires Docker daemon + network egress for image pulls (postgres:17-trixie, rabbitmq:4.1, qdrant v1.18, alpine:3.20). Verification environment has no Docker access. NOTE: this will FAIL today due to the `/health` typo in the brain healthcheck (gap 1) — the assertion test is what surfaces gap 1 in a live runner."
  - test: "Run `bash scripts/smoke-up.sh full` end-to-end on a Docker host"
    expected: "Full 10-service stack reaches healthy within 360s; same /healthz + /readyz + drain checks pass"
    why_human: "Same as above — requires Docker, plus Langfuse subsystem first-boot (ClickHouse + MinIO + Redis). Cannot run programmatically."
  - test: "Verify SIGTERM is forwarded to uvicorn (not absorbed by sh)"
    expected: "`docker exec brain ps -o pid,comm 1` shows uvicorn / python — NOT sh. After `docker stop`, the container should exit cleanly within the grace window with structlog `shutdown_complete` line in logs."
    why_human: "Behavioral container test; covers CR-01 from REVIEW which is fixed only by adding `exec` to the Dockerfile CMD."
  - test: "Verify integration tests pass against testcontainers"
    expected: "`uv run pytest -q -m integration` exits 0 (covers tests/integration/test_migrate.py and tests/integration/test_shutdown.py — both schemas land after brain-migrate, idempotent on re-run)"
    why_human: "Requires Docker for testcontainers.postgres.PostgresContainer('postgres:17-trixie'); verification environment has no Docker. The FOUND-07 dual-schema assertion (canonical brain.alembic_version + langgraph.checkpoints) only runs here."
  - test: "Validate gitleaks pre-commit hook intercepts a real-looking secret"
    expected: "Stage a temp file containing `OPENAI_API_KEY=sk-thisisafaketestkey1234567890abc`, run `gitleaks protect --staged --config .gitleaks.toml` → non-zero exit; matching rule reported"
    why_human: "Verification environment does not have the gitleaks binary in PATH; canary test must run on a machine with the pre-commit toolchain installed."
---

# Phase 1: Foundations & Compose Skeleton Verification Report

**Phase Goal:** Operator can `docker compose up` and reach a healthy Brain process with all infrastructure dependencies on a green status check; foundational conventions (pinned deps, dual schemas, gitignored secrets, structured logs, schema_version) are locked.
**Verified:** 2026-05-22T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                          | Status     | Evidence |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| 1   | `uv lock --check` succeeds; LangGraph triple exact-pinned (FOUND-02)                                            | VERIFIED   | `grep -E '^\\s*"langgraph(-checkpoint(-postgres)?)?==' pyproject.toml \| wc -l` = 3 (matches plan acceptance). pyproject.toml lines 13-15 carry the three `==` pins. |
| 2   | `.python-version` pins 3.12; pyproject `requires-python = "==3.12.*"` (FOUND-01)                                | VERIFIED   | `.python-version` contains `3.12`; pyproject.toml line 5. |
| 3   | `.env` is gitignored; `.env.example` is NOT (FOUND-12, DEPLOY-07)                                                | VERIFIED   | `git check-ignore .env` exit 0; `git check-ignore .env.example` exit 1. |
| 4   | 11 sub-packages importable (api, workers, service, graph, providers, memory, personas, vectordb, db, config, observability) | VERIFIED   | `uv run python -c "from brain import api, workers, ..."` prints OK. |
| 5   | Pydantic Settings: missing required env var fails fast; unknown `BRAIN_*` rejected (FOUND-04, FOUND-05)         | VERIFIED   | `_reject_unknown_brain_env` model_validator walks os.environ; AuthSettings.token has no default (settings.py:58). `tests/test_settings.py` passes (12 tests). |
| 6   | `schema_version` validator + `UNSUPPORTED_SCHEMA_VERSION` error code (FOUND-11)                                  | VERIFIED   | `is_supported_schema_version`, `SchemaVersion`, `UNSUPPORTED_SCHEMA_VERSION_CODE` all exported from `brain.config`. tests/test_schema_version.py passes. |
| 7   | `MAX_REQUEST_BODY_BYTES == 32 * 1024` (AUTH-04 constant published)                                               | VERIFIED   | `brain.config.MAX_REQUEST_BODY_BYTES` = 32768; tests/test_payload_cap.py passes. Phase 3 wires middleware (correctly deferred). |
| 8   | Provider API keys (OPENAI_API_KEY, GEMINI_API_KEY) only in settings.py source (AUTH-03)                          | VERIFIED   | Grep returns only a Do-NOT mention in observability/README.md (doc string, not code). Settings.openai_api_key / .gemini_api_key are the only access points. |
| 9   | structlog JSON logs end-to-end; uvicorn loggers routed via ProcessorFormatter (FOUND-10)                         | VERIFIED   | `configure_logging` in observability/logging.py wires `ProcessorFormatter`; tests/test_logging.py (6 tests) passes — JSON parseable; uvicorn.access routed without double-wrap. |
| 10  | `thread_id(bot_id, session_id) -> "{bot_id}:{session_id}"` is the only sanctioned constructor (FOUND-08)         | VERIFIED   | `thread_id('a','b')` returns `a:b`; ValueErrors raised for empty / separator-collision inputs. `scripts/lint/ban-raw-thread-id.sh` enforces at commit-time; tests/test_thread_id.py + tests/test_lint_bans.py pass. |
| 11  | `RequestIDMiddleware` binds D-14 contextvars and echoes `x-request-id`                                            | VERIFIED   | middleware.py:42-64 calls `clear_contextvars` then binds the 7 D-14 fields; tests/test_request_id_middleware.py (6 tests) passes. |
| 12  | Lint bans installed: asyncpg, sync PostgresSaver, raw thread_id, stdlib logging (with allowlist for alembic + bridge module)  | VERIFIED   | 4 ban-*.sh scripts exist, executable, referenced from .pre-commit-config.yaml; tests/test_lint_bans.py asserts each ban + each allowlist. |
| 13  | `/healthz` (200, no deps) + `/readyz` (200/503 with per-dep status, 5s cache, 2s probe timeout) (FOUND-03)        | VERIFIED   | health.py with `_CACHE_TTL_S=5.0`, `_PROBE_TIMEOUT_S=2.0`; supports `?sleep=` test affordance (clamped 0-5, 422 on negative); tests/test_health.py (11 tests) passes. |
| 14  | FastAPI app importable as `brain.api.app:app`; `main()` calls uvicorn with `timeout_graceful_shutdown` + `workers=1`  | VERIFIED   | `from brain.api.app import app; type(app).__name__ == 'FastAPI'`; main.py:14-23 passes `timeout_graceful_shutdown=settings.shutdown.grace_seconds, workers=1, log_config=None`. |
| 15  | psycopg v3 pool re-exported; asyncpg banned at import layer (FOUND-06)                                            | VERIFIED   | db/pool.py imports only psycopg_pool.AsyncConnectionPool + psycopg.AsyncConnection; ban-asyncpg.sh enforces. |
| 16  | `brain-migrate` entrypoint runs Alembic upgrade + AsyncPostgresSaver.setup() + asserts both schemas (FOUND-07)    | VERIFIED   | db/migrate.py main() does 3 steps; `assert_schemas_present` checks `to_regclass('brain.alembic_version')` AND `to_regclass('langgraph.checkpoints')`. Integration runtime proof requires Docker (human verification). |
| 17  | `build_langgraph_dsn` injects `search_path=langgraph` into the DSN options                                        | VERIFIED   | Returns `postgresql://u:p@h:5432/d?options=-csearch_path%3Dlanggraph` for clean input. (Partial issue: drops sibling -c directives — see gap 4) |
| 18  | Multi-stage Dockerfile: base→dev→prod, non-root uid 1001, healthcheck via urllib (DEPLOY-03)                      | VERIFIED   | docker/Dockerfile uses python:3.12-slim-bookworm; USER brain (uid 1001); HEALTHCHECK uses python urllib to /healthz; CMD targets brain.api.app:app with --workers 1. Build not runnable here but file matches plan acceptance. |
| 19  | `docker-compose.yml` declares 12 services with healthchecks; Brain depends_on excludes langfuse-*                  | VERIFIED   | 12 services present: brain, brain-migrate, brain-topology-init, brain-postgres, rabbitmq, qdrant, langfuse-postgres, clickhouse, redis, minio, langfuse-web, langfuse-worker. Brain depends_on lists only brain-migrate (service_completed_successfully) + brain-postgres + rabbitmq + qdrant (service_healthy). Two `postgres:17-trixie` instances (PITFALL 6.2). MinIO + Langfuse versions match plan. No `:latest` tags. |
| 20  | `docker-compose.lite.yml` is a strict subset (6 services) with `BRAIN_LANGFUSE__ENABLED=false` override            | VERIFIED   | Lite has 6 services; no langfuse-*/clickhouse/redis/minio; brain has explicit env `BRAIN_LANGFUSE__ENABLED: "false"`; check-compose-parity.sh OK (grep mode). |
| 21  | Stack reaches `service_healthy` deterministically (SC-1)                                                          | FAILED     | Brain healthcheck in both compose files probes `/health` (404) instead of `/healthz` — service can never reach `healthy`. See gap 1. |
| 22  | SIGTERM drains in-flight HTTP requests within grace window (SC-5)                                                  | FAILED     | Dockerfile CMD missing `exec` keyword — sh absorbs SIGTERM. See gap 2. Smoke-up drain assertion also uses wrong env var name (single underscore). See gap 3. |
| 23  | README quickstart works copy-paste; CI runs lint + unit + lite-smoke per-PR, full nightly (DEPLOY-08)             | VERIFIED   | README.md has Quickstart section with `cp .env.example .env`, `docker compose ... up -d --build`, curl `/healthz` + `/readyz`. `.github/workflows/ci.yml` declares 6 jobs (lint-and-unit, gitleaks, docker-build, smoke-lite, smoke-full nightly via cron, integration-tests). README does not contain prohibited Claude-credit footer strings. |

**Score:** 18/23 truths verified, 4 failed, 1 partial.

### Required Artifacts

| Artifact                                            | Expected                                                                                              | Status     | Details |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | ------- |
| `pyproject.toml`                                    | exact-pinned deps incl. LangGraph triple; ruff `T201`+`G004` config                                    | VERIFIED   | Lines 13-15 carry the three pins; `[tool.ruff.lint] select` includes T201 + G004. |
| `uv.lock`                                           | Reproducible dependency lock                                                                          | VERIFIED   | 184KB file present. |
| `.python-version`                                   | 3.12                                                                                                  | VERIFIED   | Contains `3.12`. |
| `.gitignore` / `.gitleaks.toml` / `.gitleaksignore` / `.pre-commit-config.yaml` | secrets, ruff, gitleaks, ruff-precommit hooks                                                  | VERIFIED   | All four present; `.gitleaksignore` 0 bytes (per plan). pre-commit-config references gitleaks v8.21.2 + ruff v0.15.14 + 4 local hooks. |
| 11 src/brain/<pkg>/__init__.py + README.md          | Each subpackage documented; do-not warnings present                                                   | VERIFIED   | All 11 packages present with the required Do-NOT lines (e.g. db/README.md mentions asyncpg; observability/README.md mentions Langfuse + request path; graph/README.md mentions thread_id helper; vectordb/README.md mentions qdrant_client outside; providers/README.md mentions AsyncOpenAI + google.genai). |
| `src/brain/config/{settings,schema_version,constants}.py` | Pydantic Settings + schema_version + 32KB constant                                                 | VERIFIED   | All three present + correctly exported. |
| `.env.example`                                      | Every Settings key + Langfuse subsystem keys; <REPLACE_ME> placeholders                              | VERIFIED   | check-env-example.sh exits 0; test_env_example_parity.py (3 tests) passes; 7 placeholders. |
| `src/brain/observability/logging.py`                | structlog ProcessorFormatter bridge                                                                   | VERIFIED   | 79-line module wiring configure_logging + get_logger. |
| `src/brain/graph/thread.py`                         | thread_id helper                                                                                       | VERIFIED   | Present, validates empty + separator collision. |
| `src/brain/api/middleware.py`                       | RequestIDMiddleware                                                                                   | VERIFIED   | 65-line module binding D-14 fields. |
| `scripts/lint/*.sh` (4 ban scripts)                 | All executable, with correct allowlists                                                               | VERIFIED   | All 4 exist + executable; tests/test_lint_bans.py asserts behaviour. |
| `src/brain/api/{app,health,main}.py`                | FastAPI app + lifespan + /healthz + /readyz + uvicorn entrypoint                                      | VERIFIED   | All three present; lifespan opens pool/rabbit/qdrant; lifespan partial-startup leak risk noted in gap 4 (not a blocker but flagged). |
| `src/brain/db/{pool,checkpointer,migrate}.py`       | psycopg v3 re-export + DSN helper + brain-migrate entrypoint                                          | VERIFIED   | All three present. checkpointer.build_langgraph_dsn has the WR-04 sibling-options issue (gap 5). |
| `alembic.ini` / `alembic/env.py` / `alembic/script.py.mako` / `alembic/versions/.gitkeep` / `alembic/versions/0001_create_brain_schema.py` | Alembic configured for brain.* only (version_table_schema='brain', include_name filter)                                     | VERIFIED   | env.py uses `version_table_schema="brain"`, `include_name` returns `name == "brain"` for schemas; 0001 migration runs `CREATE SCHEMA IF NOT EXISTS brain`. |
| `docker/Dockerfile`                                 | base→dev→prod; non-root; healthcheck via urllib                                                       | PARTIAL    | Multi-stage shape correct; HEALTHCHECK uses urllib.request to /healthz; CMD missing `exec` (CR-01 blocker — see gap 2). |
| `.dockerignore`                                     | excludes .env, .git, .venv, tests/, .planning/                                                        | VERIFIED   | All exclusions present including negated `!README.md`. |
| `docker-compose.yml` / `docker-compose.lite.yml`    | full 12 services + lite 6 services; healthchecks; pinned tags                                          | PARTIAL    | All services + tags + dependencies correct; BUT brain healthcheck probes `/health` (404 — never exists). See gap 1. |
| `compose/brain-topology-init/README.md`             | DEPLOY-06 placeholder doc                                                                              | VERIFIED   | Present. |
| `scripts/{smoke-up,check-env-example,check-compose-parity,smoke-readme}.sh` | 4 scripts executable                                                                                  | PARTIAL    | All present + executable; smoke-up.sh has the WR-02 env-name typo. See gap 3. |
| `tests/test_env_example_parity.py`                   | Recursive walker for nested model parity                                                              | VERIFIED   | 3 tests; all pass. |
| `.github/workflows/ci.yml`                          | 6 jobs: lint-and-unit, gitleaks, docker-build, smoke-lite, smoke-full (nightly cron), integration-tests | VERIFIED   | All 6 jobs declared; smoke-full uses `if: github.event_name == 'schedule'`. |
| `README.md`                                          | Quickstart + repo map + invariants table; no Claude footer                                            | VERIFIED   | Contains quickstart (cp .env.example .env, docker compose up, curl /healthz + /readyz); no `🤖 Generated with` / `Co-Authored-By: Claude` strings. |

### Key Link Verification

| From                                          | To                                                | Via                                                 | Status     | Details |
| --------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ---------- | ------- |
| `pyproject.toml [tool.ruff.lint]`             | `alembic/env.py`                                  | per-file-ignores                                    | VERIFIED   | Line 53 ignores G004+T201 for alembic/env.py. |
| `.pre-commit-config.yaml`                     | `.gitleaks.toml`                                  | `--config .gitleaks.toml`                            | VERIFIED   | Pre-commit hook invokes gitleaks with that config flag. |
| `src/brain/config/__init__.py`                | settings.py / schema_version.py / constants.py    | re-exports                                          | VERIFIED   | Public surface re-exported. |
| `src/brain/api/middleware.py`                 | observability/logging.py                          | structlog.contextvars.bind_contextvars              | VERIFIED   | Middleware binds contextvars consumed by `structlog.contextvars.merge_contextvars` processor. |
| `src/brain/api/app.py`                        | health router + middleware + configure_logging    | include_router / add_middleware / call             | VERIFIED   | All three wired in lifespan + create_app(). |
| `src/brain/api/main.py`                       | settings.shutdown.grace_seconds                   | timeout_graceful_shutdown=                         | VERIFIED   | main.py:18 passes it to uvicorn.run. |
| `src/brain/db/migrate.py`                     | alembic upgrade head                              | subprocess.run(['alembic','upgrade','head'])        | VERIFIED   | Line 44. |
| `src/brain/db/migrate.py`                     | brain.db.checkpointer.async_postgres_saver        | import                                              | VERIFIED   | Line 31. |
| `alembic/env.py`                              | brain.config.settings.get_settings                | import + .postgres.dsn                              | VERIFIED   | env.py line 33: `settings.postgres.dsn` is wired into `sqlalchemy.url`. |
| `docker/Dockerfile prod CMD`                  | `brain.api.app:app`                               | uvicorn brain.api.app:app                          | VERIFIED   | CMD references it. |
| `docker-compose.yml brain.depends_on`         | brain-migrate + brain-postgres + rabbitmq + qdrant | conditions                                          | VERIFIED   | Exactly these four; NO langfuse-* anywhere in brain.depends_on. |
| `docker-compose.yml brain.healthcheck`        | `/healthz`                                        | wget probe                                          | FAILED     | Probes `/health` (404). Compose-level healthcheck overrides the Dockerfile-baked one — service will never reach `healthy`. |
| `.github/workflows/ci.yml smoke-lite step`     | `scripts/smoke-up.sh lite`                        | shell                                               | VERIFIED   | Line `bash scripts/smoke-up.sh lite` present. |
| `README.md Quickstart`                         | `docker-compose.lite.yml` + `.env.example`         | text reference                                      | VERIFIED   | Both filenames + curl commands present. |

### Data-Flow Trace (Level 4)

| Artifact                  | Data Variable                                                | Source                                                                 | Produces Real Data | Status      |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------ | ----------- |
| `health.py /readyz`       | `pool, rabbit, qdrant` from `request.app.state`               | lifespan opens AsyncConnectionPool / RobustConnection / AsyncQdrantClient | Yes (probes wired) | FLOWING     |
| `migrate.py main()`       | `settings.postgres.dsn`                                       | Settings (env-driven via Pydantic)                                      | Yes                | FLOWING     |
| `app.py lifespan`         | `app.state.pool`, `app.state.rabbit`, `app.state.qdrant`, `app.state.settings` | open() calls succeed during startup                                    | Yes (subject to partial-startup leak — gap 4) | FLOWING |
| `RequestIDMiddleware`     | `request_id` (header → contextvar → log lines)                | Header or uuid4()                                                       | Yes                | FLOWING     |

### Behavioral Spot-Checks

| Behavior                                              | Command                                                                                | Result                                  | Status |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| 11-package import chain                               | `uv run python -c "from brain import api,workers,...; print('OK')"`                    | `OK`                                    | PASS   |
| Public config surface                                  | `uv run python -c "from brain.config import Settings, get_settings, MAX_REQUEST_BODY_BYTES, SchemaVersion, is_supported_schema_version; print(MAX_REQUEST_BODY_BYTES)"` | `32768` | PASS   |
| `thread_id` builder                                    | `uv run python -c "from brain.graph import thread_id; print(thread_id('a','b'))"`     | `a:b`                                   | PASS   |
| `build_langgraph_dsn`                                  | `uv run python -c "from brain.db import build_langgraph_dsn; out=build_langgraph_dsn('postgresql://u:p@h:5432/d'); assert 'search_path' in out and 'langgraph' in out; print(out)"` | `postgresql://u:p@h:5432/d?options=-csearch_path%3Dlanggraph` | PASS   |
| LangGraph exact-pin grep                              | `grep -E '^\\s*"langgraph(-checkpoint(-postgres)?)?==' pyproject.toml \| wc -l`        | `3`                                     | PASS   |
| `.env` gitignored                                     | `git check-ignore .env`                                                                | exit 0                                  | PASS   |
| `.env.example` NOT gitignored                          | `git check-ignore .env.example`                                                        | exit 1                                  | PASS   |
| AUTH-03 grep                                           | `grep -rE 'OPENAI_API_KEY\|GEMINI_API_KEY' src/brain/ \| grep -v 'settings.py'`         | Only README doc-string (not code)        | PASS   |
| Unit tests                                             | `uv run pytest -q -m "not integration"`                                                | `86 passed, 10 deselected`              | PASS   |
| Ruff                                                   | `uv run ruff check /root/Brain/`                                                       | `All checks passed!` (with one noqa-formatting warning on observability/logging.py:1 — see IN-03 in review) | PASS   |
| `check-env-example.sh`                                 | `bash scripts/check-env-example.sh`                                                    | `[check-env-example] OK`                | PASS   |
| `check-compose-parity.sh`                              | `bash scripts/check-compose-parity.sh`                                                 | `[check-compose-parity] OK (grep mode)` | PASS   |
| `env-example-parity` pytest                            | `uv run pytest tests/test_env_example_parity.py -x`                                    | `3 passed`                               | PASS   |
| `smoke-up.sh` syntax                                   | `bash -n scripts/smoke-up.sh`                                                          | exit 0                                  | PASS   |
| `smoke-readme.sh` syntax                               | `bash -n scripts/smoke-readme.sh`                                                      | exit 0                                  | PASS   |
| `docker compose -f docker-compose.yml config`         | with .env present                                                                       | exits 0                                 | PASS   |
| `docker compose -f docker-compose.lite.yml config`    | with .env present                                                                       | exits 0                                 | PASS   |
| Integration tests                                     | `uv run pytest -q -m integration`                                                       | n/a (Docker required)                   | SKIP — requires Docker. Routed to human verification. |
| `bash scripts/smoke-up.sh lite` end-to-end             | requires Docker daemon                                                                  | n/a                                     | SKIP — routed to human verification. |
| Dockerfile `exec` check                                | `grep "exec" docker/Dockerfile \| grep -i uvicorn`                                     | empty (no `exec` keyword in CMD)        | FAIL — confirms CR-01. |
| smoke-up grace var name                                | `grep BRAIN_SHUTDOWN scripts/smoke-up.sh`                                              | `BRAIN_SHUTDOWN_GRACE_SECONDS` (single underscore) | FAIL — confirms WR-02. |
| Brain healthcheck endpoint                             | `grep -F "/health" docker-compose*.yml`                                                 | Both files probe `/health` (not `/healthz`) | FAIL — see gap 1. |

### Requirements Coverage

| Requirement | Source Plan      | Description                                                       | Status     | Evidence |
| ----------- | ---------------- | ----------------------------------------------------------------- | ---------- | -------- |
| FOUND-01    | 01-01            | Python 3.12 + pinned deps via uv                                   | SATISFIED  | pyproject.toml `requires-python = "==3.12.*"`, uv.lock present. |
| FOUND-02    | 01-01            | LangGraph triple exact-pinned                                      | SATISFIED  | 3-line `==` grep verified. |
| FOUND-03    | 01-05            | /healthz + /readyz with per-dep status                              | SATISFIED  | Endpoints implemented; unit tests cover all branches; runtime proof gated on Docker (human). |
| FOUND-04    | 01-03            | All config via env (no hardcoded endpoints)                         | SATISFIED  | Settings nested model + .env.example parity. |
| FOUND-05    | 01-03            | Fail-fast Pydantic Settings on missing/malformed env                | SATISFIED  | AuthSettings.token has no default; `extra="forbid"`; `_reject_unknown_brain_env` walker. |
| FOUND-06    | 01-04, 01-06     | psycopg v3 only; asyncpg banned                                     | SATISFIED  | db/pool.py imports only psycopg/psycopg_pool; ban-asyncpg.sh enforces; tests/test_lint_bans.py asserts. |
| FOUND-07    | 01-06            | Dual schemas (brain.* Alembic + langgraph.* checkpointer)           | NEEDS HUMAN | Implementation present + integration test exists; programmatic proof requires Docker for testcontainers. |
| FOUND-08    | 01-04            | thread_id helper enforced by lint                                   | SATISFIED  | helper + ban-raw-thread-id.sh + tests/test_thread_id.py. |
| FOUND-09    | 01-05, 01-09     | Graceful drain on SIGTERM                                            | BLOCKED    | Dockerfile CMD lacks `exec` → sh absorbs SIGTERM; smoke-up.sh drain assertion uses wrong env name. See gaps 2 + 3. |
| FOUND-10    | 01-04            | structlog JSON; no print / stdlib logging in prod code              | SATISFIED  | configure_logging wires ProcessorFormatter; ruff T201/G004 + ban-stdlib-logging.sh enforce. |
| FOUND-11    | 01-03            | schema_version validator + supported list                            | SATISFIED  | UNSUPPORTED_SCHEMA_VERSION_CODE constant + AfterValidator. |
| FOUND-12    | 01-01, 01-03     | .env gitignored; gitleaks pre-commit                                  | SATISFIED  | .gitignore + .gitleaks.toml + pre-commit-config hook present. Canary gitleaks test requires gitleaks CLI (human). |
| AUTH-03     | 01-03            | Provider keys only in settings.py source                              | SATISFIED  | Grep confirms only doc-strings outside settings.py. |
| AUTH-04     | 01-03            | 32 KiB payload cap constant                                           | SATISFIED  | MAX_REQUEST_BODY_BYTES = 32768. Phase 3 middleware enforcement (correctly deferred). |
| DEPLOY-01   | 01-08            | Full 10-service compose                                               | BLOCKED    | All 10 services declared; BUT brain healthcheck typo prevents reaching service_healthy → SC-1 fails. See gap 1. |
| DEPLOY-02   | 01-08            | Lite subset compose                                                   | BLOCKED    | Same healthcheck typo in lite. See gap 1. |
| DEPLOY-03   | 01-07            | Multi-stage Dockerfile (base→dev→prod, non-root, healthcheck)         | BLOCKED    | Structure correct; CMD missing `exec` (CR-01 unfixed) — see gap 2. |
| DEPLOY-04   | 01-08            | All services declare healthchecks; depends_on uses service_healthy   | SATISFIED  | All long-running services have healthcheck blocks; brain depends_on uses service_healthy / service_completed_successfully. (Brain's own healthcheck wrong endpoint — see gap 1.) |
| DEPLOY-05   | 01-06, 01-08     | brain-migrate init runs Alembic before brain                          | SATISFIED  | brain.depends_on uses `condition: service_completed_successfully` on brain-migrate. |
| DEPLOY-06   | 01-08            | brain-topology-init slot reserved                                     | SATISFIED  | Service present in both compose files; README documents Phase 8 fill plan. |
| DEPLOY-07   | 01-03            | .env.example documents every variable; .env gitignored                | SATISFIED  | check-env-example.sh + test_env_example_parity.py both green. |
| DEPLOY-08   | 01-09            | README quickstart works copy-paste                                    | NEEDS HUMAN | README content correct; verbatim copy-paste validation needs Docker (smoke-readme.sh script exists but is a runtime check). |

### Anti-Patterns Found

| File                  | Line | Pattern                                            | Severity   | Impact |
| --------------------- | ---- | -------------------------------------------------- | ---------- | ------ |
| `docker/Dockerfile`   | 95   | `CMD ["sh", "-c", "uvicorn ..."]` without `exec`   | BLOCKER    | SIGTERM not forwarded to uvicorn → FOUND-09 / D-13 broken. |
| `docker-compose.yml`  | 126  | `wget -qO- http://localhost:8000/health` (404)     | BLOCKER    | Brain never reaches service_healthy. |
| `docker-compose.lite.yml` | 112 | Same `/health` typo                              | BLOCKER    | Lite stack never reaches healthy → SC-1 fails. |
| `scripts/smoke-up.sh` | 140  | `BRAIN_SHUTDOWN_GRACE_SECONDS` (single underscore) | WARNING    | Drain assertion silently insensitive to env override. |
| `src/brain/api/app.py` | 57-76 | Resource opens outside try/AsyncExitStack         | WARNING    | Partial-startup failure leaks already-opened resources. |
| `src/brain/api/middleware.py` | 48 | Unsanitized X-Request-ID echoed + bound        | WARNING    | Log-injection / oversized-header reflection (WR-03). |
| `src/brain/db/checkpointer.py` | 29-31 | options replacement drops sibling -c directives | WARNING    | Silent loss of operator-set GUCs (WR-04). |
| `scripts/check-compose-parity.sh` | 15-32 | `2>/dev/null \|\| true` after every yq call | WARNING    | Silent false-positive parity (WR-05). |
| `docker-compose.yml`  | brain.environment | Lacks explicit `BRAIN_LANGFUSE__ENABLED` (lite has it, full does not) | INFO    | Asymmetric override (WR-06). |
| `src/brain/observability/logging.py` | 1 | `# noqa: D-15` is not a real ruff code      | INFO       | Ruff warns; cosmetic (IN-03). |
| `src/brain/db/migrate.py` | 89-90 | Two `asyncio.run()` calls back-to-back          | INFO       | Wasteful but functional (IN-04). |
| `src/brain/config/settings.py` | 165-174 | `object.__setattr__` post-init for provider keys | INFO    | Bypasses Pydantic validation; works but inelegant (IN-01). |

### Human Verification Required

See YAML frontmatter `human_verification` block. Summary: 5 items require Docker-based or live-environment runs (lite smoke, full smoke, SIGTERM behavior, integration tests, gitleaks canary).

### Gaps Summary

Phase 1 ships a thorough, well-tested foundation: 86 unit tests pass, ruff + lint bans + env parity all green, all 11 packages importable, every artifact present at the file level. Plans 01-01 through 01-09 are individually complete and the SUMMARYs/REVIEW were honest about issues.

**The blocking problem is that two issues identified in `01-REVIEW.md` were never fixed, plus one new defect (the brain compose healthcheck endpoint typo) that the review missed:**

1. **`/health` vs `/healthz` typo** in both compose files' brain healthcheck → service never reaches `service_healthy` → smoke-up.sh exit 3 → SC-1 fails deterministically.
2. **Dockerfile CMD missing `exec`** → sh absorbs SIGTERM → uvicorn graceful-shutdown never runs → SC-5 (drain) fails. The smoke-up.sh drain assertion would still pass because the in-flight `/healthz?sleep=2` only takes 2s and `docker compose stop` has a default 10s grace, so the request happens to finish before the kernel SIGKILL — masking the bug. CR-01 in 01-REVIEW.md flagged this.
3. **smoke-up.sh env-var name typo** (`BRAIN_SHUTDOWN_GRACE_SECONDS` single underscore) → drain assertion silently ignores BRAIN_SHUTDOWN__GRACE_SECONDS overrides. WR-02 flagged.

Two non-blocking but real defects from the review that ship as Warnings (gap 4-5 above) and several Info-level cosmetic issues round out the picture.

All five gaps are concentrated in three files (`docker/Dockerfile`, `docker-compose.yml`, `docker-compose.lite.yml`, `scripts/smoke-up.sh`, `src/brain/api/app.py`, `src/brain/db/checkpointer.py`) and each has an actionable fix. Fixing gaps 1, 2, 3 unblocks ROADMAP SC-1 and SC-5; the remaining two are robustness improvements that would close 01-REVIEW.md Warnings.

---

_Verified: 2026-05-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
