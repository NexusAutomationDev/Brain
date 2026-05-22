# Phase 1: Foundations & Compose Skeleton — Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the walking skeleton: a `docker compose up` brings the full 10-service stack (Brain + brain-postgres + rabbitmq + qdrant + langfuse-web + langfuse-worker + langfuse-postgres + clickhouse + redis + minio) to `service_healthy` deterministically; FastAPI exposes `/healthz` and `/readyz`; Pydantic `Settings` validates env at startup; multi-stage Dockerfile produces base/dev/prod images; Alembic + LangGraph checkpointer schemas are bootstrapped by a single `brain-migrate` init container; structlog JSON logging, gitleaks, `schema_version` rejection, and `thread_id` helper conventions are locked.

**Phase 1 does NOT include:** webhook business logic (Phase 3), bot CRUD (Phase 2), Langfuse callback wiring (Phase 4), provider adapters (Phase 5), short-term memory (Phase 6), vector memory (Phase 7), RabbitMQ consumer (Phase 8), retention/rotation/runbook (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### Source Layout & Module Skeleton
- **D-01:** `src/brain/` layout (src-layout). Tests live in `tests/` at repo root. `pyproject.toml` declares `[tool.hatch.build.targets.wheel] packages = ["src/brain"]` (or equivalent for the chosen build backend; `uv` + hatchling is the default expectation).
- **D-02:** Create **all 11 packages** from ARCHITECTURE.md as Phase-1 stubs (each with `__init__.py` and a one-line module docstring describing its responsibility): `src/brain/{api,workers,service,graph,providers,memory,personas,vectordb,db,config,observability}/`. Empty packages are intentional — they lock architectural seams before later phases fill them in. The planner should add a short `README.md` per package describing what it owns + which phase fills it.
- **D-03 (Claude's Discretion):** Settings shape. Recommendation captured during discussion: nested sub-models (`PostgresSettings`, `RabbitMQSettings`, `QdrantSettings`, `LangfuseSettings`, `AuthSettings`) aggregated by a top-level `Settings(BaseSettings)`. Env delimiter `__` (e.g. `BRAIN_POSTGRES__DSN`). Planner may collapse to flat if the variable count comes in low (< ~15 vars).
- **D-04:** `.env.example` ships **real working dev defaults for internal infrastructure** (Postgres URL/user/password, RabbitMQ URL with `guest:guest`, Qdrant URL, Langfuse internal URLs, ClickHouse/Redis/MinIO credentials, `BRAIN_SHUTDOWN_GRACE_SECONDS=30`, `BRAIN_SUPPORTED_SCHEMA_VERSIONS=1`) so a fresh clone + `docker compose up` + `curl` works. Only **external secrets** are `<REPLACE_ME>` placeholders: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `BRAIN_AUTH_TOKEN`. `.env` itself is gitignored (FOUND-12).

### Health Checks & Migration Bootstrap
- **D-05:** `/readyz` probes **all three core deps from day 1**: Postgres, RabbitMQ, Qdrant. Even though no Phase-1 code consumes RabbitMQ/Qdrant yet, the probe satisfies Phase 1 success criterion #2 and surfaces compose-misconfig early. Each failed dep is reported individually in the 503 response body (e.g. `{"status":"not_ready","checks":{"postgres":"ok","rabbitmq":"timeout","qdrant":"ok"}}`). `/healthz` is pure liveness (200 if process is up).
- **D-06 (Claude's Discretion):** Probe implementation pattern. Recommendation captured during discussion: active probes with short per-dep timeout (≤2s) executed per request, with a 5-second in-process cache to avoid probe storms. SQL `SELECT 1` for Postgres, AMQP channel open for RabbitMQ, `GET /healthz` for Qdrant. Planner is free to refine the cache window and probe surface.
- **D-07:** **Single `brain-migrate` init container** does both schema setups in sequence: (1) `alembic upgrade head` against `brain.*` schema, then (2) a small Python entrypoint that constructs `AsyncPostgresSaver.from_conn_string(...)` and calls `.setup()` to create `langgraph.*` schema. Image is the Brain prod image (re-uses the same Python env). Brain service declares `depends_on: brain-migrate: condition: service_completed_successfully`. Single container = atomic ordering, one log stream to debug.
- **D-08:** Legacy checkpoint replay fixture test (PITFALL 1.1) is **deferred to Phase 6** when `AsyncPostgresSaver` actually writes state. Phase 1 only calls `.setup()`; there's no real checkpoint to snapshot. Phase 1 must still **exact-pin** `langgraph`, `langgraph-checkpoint`, `langgraph-checkpoint-postgres` in `pyproject.toml` (no `^`, no `~`) per FOUND-02.

### Langfuse Subsystem & Compose Topology
- **D-09:** **Hand-roll all 5 Langfuse services** in `docker-compose.yml` with explicit pinned image tags (`langfuse/langfuse:3.175.0`, `langfuse/langfuse-worker:3.175.0`, `postgres:17-trixie`, `clickhouse/clickhouse-server:24-alpine`, `redis:7-alpine`, and a pinned `minio/minio:RELEASE.YYYY-MM-DD...` tag — planner picks a current stable tag at planning time). Do NOT `include:` upstream Langfuse compose. Pins live in our repo so upgrades are explicit PRs.
- **D-10 (Claude's Discretion):** Lite override mechanism. Two viable options:
  - (a) Compose `profiles:` — Langfuse services tagged `profiles: ["observability"]`; `docker compose up` = lite, `docker compose --profile observability up` = full. Single source of truth.
  - (b) Separate `docker-compose.lite.yml` that re-declares only `brain + brain-migrate + brain-postgres + rabbitmq + qdrant`.
  Planner picks. Recommendation: **profiles** because DEPLOY-02 wording ("`docker-compose.lite.yml runs the inner-loop dev subset`") may need to be reconciled — if profiles is chosen, either keep a thin `docker-compose.lite.yml` that just sets `COMPOSE_PROFILES=` or relax DEPLOY-02 to "lite mode = default `docker compose up`". Plan needs to make this explicit.
- **D-11:** `depends_on: condition: service_healthy` for the **core path** Brain actually needs: `brain-migrate` (service_completed_successfully), `brain-postgres`, `rabbitmq`, `qdrant`. **Langfuse is NOT in Brain's `depends_on`** — observability must never block the request path (PITFALL 8.1, OBS-04). Langfuse-web/worker still declare their own healthchecks and depends_on their own Postgres/ClickHouse/Redis/MinIO so the Langfuse subsystem starts coherently on its own.
- **D-12:** Host port exposure: **Brain `:8000`, Langfuse-web `:3000`, RabbitMQ management `:15672`, Qdrant dashboard `:6333`** published to host. AMQP `:5672`, Postgres `:5432` (both instances), ClickHouse, Redis, MinIO are **internal-only** on the `brain-net` user-defined bridge network. Devs needing direct SQL/Redis access use `docker compose exec`.

### Graceful Shutdown, Logging, Schema Version, Lint
- **D-13 (Claude's Discretion):** Graceful shutdown mechanism. Recommendation captured during discussion: rely on uvicorn's native SIGTERM handling (uvicorn `--workers N`, no gunicorn per STACK.md §1) + FastAPI `lifespan` async context manager to close the psycopg async pool, Qdrant client, and (in Phase 8) AMQP consumer. Grace window is env-configurable via `BRAIN_SHUTDOWN_GRACE_SECONDS` (default 30s). Phase 1 must leave the lifespan structured so Phase 8 can plug AMQP drain into the same shutdown without refactoring.
- **D-14 (Claude's Discretion):** structlog canonical fields. Recommendation captured during discussion: every log line carries `ts, level, event, service="brain", request_id, bot_id, session_id, trace_id, schema_version, ingress`. Fields not yet known emit `"-"` (e.g. `trace_id="-"` until Phase 4 wires Langfuse, `bot_id="-"` until Phase 3 parses payload). `request_id` generated by an early FastAPI middleware (e.g. `X-Request-ID` header pass-through or UUID4 fallback). `ingress="http"` in Phase 1; Phase 8 adds `"amqp"`. Use structlog `contextvars` so nested log calls inherit context without manual bind.
- **D-15:** Ban `print` + stdlib `logging` (FOUND-10) via **ruff rules `T201` (print) and `G004` (logging f-string format)** + a **pre-commit shell hook** that greps for `^\s*import logging|^\s*from logging` in `src/brain/` and fails the commit. **Exception:** `alembic/env.py` is allowed to use stdlib `logging` (Alembic's own machinery uses it; rewriting Alembic's logger isn't worth it). The grep allowlists `alembic/` explicitly.
- **D-16:** `schema_version` (FOUND-11) is an **integer**, sent as JSON `"schema_version": 1`. Supported versions come from env `BRAIN_SUPPORTED_SCHEMA_VERSIONS` (comma-separated list of ints, default `"1"`). Validation lives in a **Pydantic `field_validator`** on the (future) `BrainRequest` model — Phase 1 ships the validator helper and the env var, Phase 3 attaches it to `BrainRequest`. Rejection: HTTP `422` with the error envelope `{"error":{"code":"UNSUPPORTED_SCHEMA_VERSION","message":"...","traceId":"-"}}`. Error code is added to the documented codes list that Phase 3 finalizes.
- **D-17 (Claude's Discretion):** Lint-rule scope on day 1. Recommendation captured during discussion: Phase 1 implements only the bans whose target modules have code in Phase 1 — i.e. (a) `thread_id(bot_id, session_id)` helper in `src/brain/graph/thread.py` (or similar) with a pre-commit grep banning the literal pattern `f"{...}:{...}"` for thread_id construction outside the helper; (b) ban `asyncpg` imports anywhere; (c) ban `from langgraph.checkpoint.postgres import PostgresSaver` outside `scripts/` (sync checkpointer). Bans for raw `qdrant_client` and raw provider clients (`AsyncOpenAI`, `genai.Client`) outside their owning packages land in Phases 7 and 5 respectively when those packages get real code. This avoids orphaned lint rules pointing at empty modules.
- **D-18:** Gitleaks (FOUND-12) integrated in **both** layers: (a) **pre-commit hook** `gitleaks protect --staged --config .gitleaks.toml` blocks local commits with secrets; (b) **CI job** `gitleaks detect --redact --config .gitleaks.toml` catches anything that slipped past hooks (e.g. branch pushed from a machine without hooks installed). Shared `.gitleaks.toml` lives at repo root. Empty `.gitleaksignore` ships for now; planner adds entries only if a real false-positive surfaces.

### Claude's Discretion (summary)
- D-03 Settings nesting depth, D-06 readyz probe cache window, D-10 lite override mechanism (profiles vs separate file), D-13 shutdown mechanism details, D-14 structlog config wiring, D-17 lint rule scope expansion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project intent & constraints
- `.planning/PROJECT.md` — Tech stack constraints (Python + LangGraph, Postgres single transactional store, compose-up deployment, env-only config, Bearer token, Langfuse observability)
- `.planning/REQUIREMENTS.md` §Foundations (FOUND-01..12), §Authentication & Security (AUTH-03, AUTH-04), §Deployment (DEPLOY-01..08) — the 22 v1 requirements this phase owns
- `.planning/ROADMAP.md` §"Phase 1: Foundations & Compose Skeleton" — goal + 5 observable success criteria
- `CLAUDE.md` — Conventional Commits + emoji policy (mandatory for every commit); locked tech stack mirror

### Research artifacts
- `.planning/research/SUMMARY.md` §"Phase 1: Foundations & Compose Skeleton" — phase rationale, locked decisions table, research flags
- `.planning/research/STACK.md` — full version pins:
  - §1 FastAPI 0.136.1 + uvicorn 0.47.0 + pydantic 2.13.4 + pydantic-settings 2.14.1
  - §2 langgraph 1.2.1 + langgraph-checkpoint-postgres 3.1.0 + langchain-core 1.4.0 (exact-pin discipline)
  - §3 psycopg[binary,pool] 3.3.4 + SQLAlchemy 2.0.49 + Alembic 1.18.4 + postgres 17-trixie (asyncpg forbidden)
  - §6 aio-pika 9.6.2 + rabbitmq 4.1-management-alpine
  - §7 langfuse 4.6.1 SDK + langfuse server v3.175.0 + 5-service subsystem topology
  - §8 uv 0.11.16 + ruff 0.15.14 + pytest 9.0.3 + structlog 25.5.0
  - §9 Docker Compose topology — base image (python:3.12-slim-bookworm), pinned services, healthchecks pattern, network topology, lite override
  - §10 Anti-recommendations (asyncpg, sync pika, langchain meta, pydantic v1, black/isort/flake8, poetry, chromadb, langfuse v2, python:3.13/alpine, `:latest`, gunicorn in front of uvicorn)
- `.planning/research/ARCHITECTURE.md` §"System Overview" + §"Component Boundaries" — the 11-module layout that D-02 instantiates
- `.planning/research/PITFALLS.md`:
  - §1.1 Checkpointer schema breaks across minor versions (CRITICAL) — exact-pin + legacy replay fixture (deferred per D-08)
  - §1.2 Sync PostgresSaver inside async app blocks loop (HIGH) — async-everywhere lint (D-17)
  - §5.1 Bearer token leaked into traces/logs — Authorization stripping middleware
  - §5.3 .env in git — gitleaks (D-18)
  - §6.1 Schema collisions — dual schemas `langgraph.*` + `brain.*` (D-07)
  - §6.2 Sharing one Postgres between Brain and Langfuse — two instances (locked in STATE.md)
  - §7.1 Langfuse subsystem misconfig — 5 sidecars (D-09)
  - §8.1 Langfuse outage takes Brain down — fire-and-forget + circuit breaker (D-11 keeps Langfuse out of depends_on)
  - §10.1 SessionId collisions across bots — `thread_id` helper (D-17)
- `.planning/research/FEATURES.md` Table Stakes: TS-2 `/healthz`, TS-3 `/readyz`, TS-15 `schema_version`, TS-18 env tunables (`DB_POOL_SIZE`, `RABBIT_PREFETCH`, `MAX_CONCURRENT_LLM_CALLS`), TS-20 Bearer + provider keys via `.env`

### External references (link only; planner fetches via Context7 if needed)
- LangGraph persistence docs (langchain-ai/langgraph) — `AsyncPostgresSaver.from_conn_string`, `.setup()` semantics
- `langgraph-checkpoint-postgres` PyPI README — psycopg v3 + autocommit + `row_factory` caveats
- Langfuse self-hosting v3 docs — 5-service architecture (web, worker, postgres, clickhouse, redis, minio)
- Qdrant docs — `GET /healthz` endpoint shape
- uv docs — `uv sync --frozen --no-dev` Docker layer caching pattern (STACK.md §8)
- gitleaks docs — `protect --staged` vs `detect --redact`, config schema

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None.** The repository contains only `CLAUDE.md` and `.planning/`. Phase 1 is greenfield — every file under `src/`, `tests/`, `docker/`, `compose/`, `alembic/`, `.pre-commit-config.yaml`, `pyproject.toml`, `Dockerfile`, `docker-compose.yml`, `docker-compose.lite.yml`, `.env.example`, `.gitleaks.toml`, `.gitignore` is new.

### Established Patterns
- **None to inherit.** Phase 1 establishes the patterns later phases consume. Anti-pattern guardrails are inherited from `.planning/research/PITFALLS.md` and STATE.md "Key Decisions".

### Integration Points
- All 11 stub packages from D-02 are the integration points future phases will fill (api/ ← Phase 3, workers/ ← Phase 8, service/ ← Phase 3, graph/ ← Phases 3 & 6 & 7, providers/ ← Phase 5, memory/ ← Phases 6 & 7, personas/ ← Phase 2, vectordb/ ← Phase 7, observability/ ← Phase 4, config/ ← Phase 1, db/ ← Phase 1).
- `BrainRequest` Pydantic model lives in `src/brain/api/schemas.py` (created in Phase 3) — Phase 1 must publish the `schema_version` validator helper in `src/brain/config/schema_version.py` (or similar) so Phase 3 imports it cleanly. D-16 captures this seam.
- `thread_id(bot_id, session_id)` helper lives in `src/brain/graph/thread.py` (created in Phase 1 per D-17) — Phase 6 imports it when wiring `AsyncPostgresSaver`.

</code_context>

<specifics>
## Specific Ideas

- Service criterion #1 ("`docker compose up` deterministically reaches service_healthy") is the **acceptance gate**. The plan must include a CI smoke test (or at minimum a documented script) that runs `docker compose up -d`, waits for all services healthy with a bounded timeout, hits `/healthz` and `/readyz`, and tears down. Reproducibility on a fresh clone matters more than fast inner-loop here.
- The `brain-migrate` Python entrypoint (D-07 step 2) is small enough to inline as a single `python -c "..."` invocation in the init container's CMD, but lifting it to `src/brain/db/migrate.py` makes it testable and Phase-6-friendly. Planner: prefer the module.
- DEPLOY-02 wording around `docker-compose.lite.yml` may need to be reconciled with D-10 if profiles is chosen. Flag for the plan-check.

</specifics>

<deferred>
## Deferred Ideas

None — the discussion stayed strictly inside Phase 1's roadmap-defined scope. Items naturally bound to later phases were noted in `<code_context>` as integration points rather than deferred scope creep. No backlog entries created.

</deferred>

---

*Phase: 01-foundations-compose-skeleton*
*Context gathered: 2026-05-21*
