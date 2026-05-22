# Phase 1: Foundations & Compose Skeleton — Research

**Researched:** 2026-05-22
**Domain:** Python + FastAPI + LangGraph + Postgres + Qdrant + RabbitMQ + Langfuse v3 self-hosted on Docker Compose
**Confidence:** HIGH (stack and patterns); MEDIUM (Langfuse v3 compose subsystem footprint stability); MEDIUM (MinIO supply-chain — see Open Questions)

---

## Summary

Phase 1 is greenfield infra plumbing — `docker compose up` ships a healthy 10-service stack and Brain's process boots cleanly with all guardrails in place (pinned deps, JSON logs, schema-version validator, gitleaks, dual Postgres schemas). The stack and conventions are already locked in CONTEXT.md (D-01 through D-18); this research fills in the HOWs the planner left to its discretion plus the 10 focus items the SUMMARY flagged.

Two findings move the needle for the plan: **(1) the Langfuse v3 compose subsystem requires five sidecars (postgres + clickhouse + redis + minio + a worker) with hard secrets that must ship as `<REPLACE_ME>` placeholders in `.env.example`, and the upstream `langfuse/langfuse:3` and `langfuse/langfuse-worker:3` images ship without baked healthchecks**, so Brain's compose file must add them. **(2) MinIO's community edition was archived by upstream in early 2026** — the planner must pin a specific pre-archive RELEASE tag and add a `## Known Future Work` entry to migrate to a maintained S3-compatible store (Garage, SeaweedFS, RustFS) in a later milestone. This does not block Phase 1, but pinning `:latest` would be doubly wrong here.

The validation architecture for Phase 1 is mostly **smoke tests**: assert the compose stack reaches healthy, assert `/healthz` + `/readyz` shape, assert Pydantic Settings fails fast on missing env, assert ruff catches `print` + logging-f-strings, assert gitleaks catches a seeded secret in a test commit. There is no business logic yet — concurrent-turn or cross-session-leak tests belong to Phase 6.

**Primary recommendation:** Build the compose file in two layers — `docker-compose.yml` (full 10-service stack, default `up`) and `docker-compose.lite.yml` (a separate file that re-declares only the 5 core services: brain, brain-migrate, brain-postgres, rabbitmq, qdrant). Avoid Compose `profiles:` for the lite mode because (a) DEPLOY-02 names the file explicitly, (b) two files is friction-free for new contributors who don't know the profile name, (c) profiles inside one file means Brain's `depends_on` list has to account for absent profile services. Two files = two explicit, debuggable graphs.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Source Layout & Module Skeleton**
- **D-01:** `src/brain/` layout (src-layout). Tests live in `tests/` at repo root. `pyproject.toml` declares `[tool.hatch.build.targets.wheel] packages = ["src/brain"]` (or equivalent; `uv` + hatchling is the default expectation).
- **D-02:** Create **all 11 packages** from ARCHITECTURE.md as Phase-1 stubs (each with `__init__.py` and a one-line module docstring): `src/brain/{api,workers,service,graph,providers,memory,personas,vectordb,db,config,observability}/`. Each package gets a short `README.md` describing what it owns + which phase fills it.
- **D-03 (Claude's Discretion):** Settings shape. Recommendation captured: nested sub-models (`PostgresSettings`, `RabbitMQSettings`, `QdrantSettings`, `LangfuseSettings`, `AuthSettings`) aggregated by a top-level `Settings(BaseSettings)`. Env delimiter `__`, prefix `BRAIN_`. Planner may collapse to flat if variable count is low (< ~15 vars).
- **D-04:** `.env.example` ships **real working dev defaults for internal infrastructure** so a fresh clone + `docker compose up` + `curl` works. Only **external secrets** are `<REPLACE_ME>` placeholders: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `BRAIN_AUTH_TOKEN`. `.env` itself is gitignored (FOUND-12).

**Health Checks & Migration Bootstrap**
- **D-05:** `/readyz` probes **Postgres + RabbitMQ + Qdrant** from day 1. Each failed dep reported individually in the 503 body. `/healthz` is pure liveness.
- **D-06 (Claude's Discretion):** Probe pattern. Recommendation captured: active probes with ≤2s per-dep timeout, 5-second in-process cache to avoid storms. SQL `SELECT 1` for Postgres, AMQP channel open for RabbitMQ, `GET /healthz` for Qdrant.
- **D-07:** **Single `brain-migrate` init container** runs in sequence: (1) `alembic upgrade head` against `brain.*` schema, then (2) Python entrypoint that constructs `AsyncPostgresSaver.from_conn_string(...)` and calls `.setup()` for `langgraph.*` schema. Image is the Brain prod image. Brain service declares `depends_on: brain-migrate: condition: service_completed_successfully`.
- **D-08:** Legacy checkpoint replay fixture test (PITFALL 1.1) is **deferred to Phase 6**. Phase 1 must still **exact-pin** `langgraph`, `langgraph-checkpoint`, `langgraph-checkpoint-postgres` in `pyproject.toml`.

**Langfuse Subsystem & Compose Topology**
- **D-09:** **Hand-roll all 5 Langfuse services** in `docker-compose.yml` with explicit pinned image tags. Do NOT `include:` upstream Langfuse compose. Pins live in our repo so upgrades are explicit PRs.
- **D-10 (Claude's Discretion):** Lite override mechanism (profiles vs separate `docker-compose.lite.yml`). Planner picks. (This research recommends **separate file**; see Summary.)
- **D-11:** `depends_on: condition: service_healthy` for the **core path** only: `brain-migrate` (service_completed_successfully), `brain-postgres`, `rabbitmq`, `qdrant`. **Langfuse is NOT in Brain's `depends_on`** (PITFALL 8.1, OBS-04).
- **D-12:** Host port exposure: **Brain `:8000`, Langfuse-web `:3000`, RabbitMQ management `:15672`, Qdrant dashboard `:6333`** published to host. AMQP `:5672`, Postgres `:5432`, ClickHouse, Redis, MinIO are **internal-only** on the `brain-net` user-defined bridge network.

**Graceful Shutdown, Logging, Schema Version, Lint**
- **D-13 (Claude's Discretion):** Graceful shutdown — rely on uvicorn's native SIGTERM handling + FastAPI `lifespan`. `BRAIN_SHUTDOWN_GRACE_SECONDS` env, default 30s. Lifespan structured so Phase 8 can plug AMQP drain in.
- **D-14 (Claude's Discretion):** structlog canonical fields — `ts, level, event, service="brain", request_id, bot_id, session_id, trace_id, schema_version, ingress`. Unknown fields emit `"-"`. `request_id` via middleware (X-Request-ID pass-through or UUID4). Use structlog `contextvars`.
- **D-15:** Ban `print` + stdlib `logging` via **ruff rules `T201` and `G004`** + pre-commit shell hook grepping `^\s*import logging|^\s*from logging` in `src/brain/`. **Exception:** `alembic/env.py` allowed.
- **D-16:** `schema_version` is **integer** JSON. Supported versions from env `BRAIN_SUPPORTED_SCHEMA_VERSIONS` (comma-separated, default `"1"`). Validation lives in a **Pydantic `field_validator`** helper module shipped in Phase 1, attached to `BrainRequest` in Phase 3. Rejection: HTTP `422`, code `UNSUPPORTED_SCHEMA_VERSION`.
- **D-17 (Claude's Discretion):** Lint-rule scope on day 1 — only for modules with code in Phase 1: (a) `thread_id` helper grep ban on `f"{...}:{...}"` outside helper; (b) ban `asyncpg` imports; (c) ban `from langgraph.checkpoint.postgres import PostgresSaver` (sync) outside `scripts/`. Bans for raw `qdrant_client` / `AsyncOpenAI` / `genai.Client` land in Phases 5/7.
- **D-18:** Gitleaks in **both** layers: (a) **pre-commit hook** `gitleaks protect --staged --config .gitleaks.toml`; (b) **CI job** `gitleaks detect --redact --config .gitleaks.toml`. Empty `.gitleaksignore`.

### Claude's Discretion (summary from CONTEXT.md)
D-03 Settings nesting depth, D-06 readyz probe cache window, D-10 lite override mechanism, D-13 shutdown mechanism details, D-14 structlog config wiring, D-17 lint rule scope expansion.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed strictly inside Phase 1's roadmap-defined scope. Integration points for later phases are documented in `<code_context>` of CONTEXT.md, not deferred.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Python 3.12 + pinned deps via uv | Standard Stack §1; Pinned `pyproject.toml` template below |
| FOUND-02 | LangGraph + checkpointer exact-pinned | Standard Stack §2 — exact-pin pattern in `pyproject.toml` |
| FOUND-03 | `/healthz` + `/readyz` (Postgres + RabbitMQ + Qdrant) | Architecture Patterns — Pattern 1 (active probes + cache) |
| FOUND-04 | All config from `.env`; no hardcoded endpoints | Architecture Patterns — Pattern 2 (Pydantic Settings nested) |
| FOUND-05 | Pydantic Settings validates at startup; fail fast | Architecture Patterns — Pattern 2 |
| FOUND-06 | psycopg[binary,pool] v3 throughout (asyncpg forbidden) | Standard Stack §2; PITFALL 1.2 |
| FOUND-07 | Two Postgres schemas: `langgraph.*` (checkpointer) + `brain.*` (Alembic) | Architecture Patterns — Pattern 3 (dual schema); Code Examples — Alembic env.py |
| FOUND-08 | `thread_id(bot_id, session_id) -> str` helper enforced by lint | Code Examples — thread_id helper + grep ban |
| FOUND-09 | Graceful shutdown drains in-flight HTTP requests | Architecture Patterns — Pattern 5 (lifespan + uvicorn) |
| FOUND-10 | JSON logs via structlog; no print/stdlib logging in src | Code Examples — structlog config + ruff T201/G004 |
| FOUND-11 | `schema_version` field on all payloads; reject unsupported | Code Examples — Pydantic `field_validator` helper |
| FOUND-12 | `.env` gitignored; gitleaks in pre-commit | Code Examples — gitleaks config + .gitignore + pre-commit |
| AUTH-03 | Provider API keys from env; never logged/echoed | Architecture Patterns — Pattern 2 (Settings); structlog masking discipline |
| AUTH-04 | 32KB payload cap (413 on oversize) | Stub in `api/middleware.py` for Phase 3 to wire (Phase 1 ships the limit constant + helper) |
| DEPLOY-01 | `docker-compose.yml` runs full 10-service stack | Compose Topology §A; Pinned Service Images |
| DEPLOY-02 | `docker-compose.lite.yml` runs inner-loop subset (no Langfuse) | Compose Topology §B; recommend separate file (D-10) |
| DEPLOY-03 | Multi-stage Dockerfile (base→dev→prod), non-root, healthcheck | Code Examples — multi-stage Dockerfile |
| DEPLOY-04 | All services declare healthchecks; Brain depends_on service_healthy | Healthchecks Pattern; D-11 |
| DEPLOY-05 | `brain-migrate` init container runs Alembic before Brain starts | D-07; Code Examples — migrate entrypoint |
| DEPLOY-06 | `brain-topology-init` init container declares MQ topology | Phase 8 — Phase 1 only reserves the slot in compose comments |
| DEPLOY-07 | `.env.example` documents every var; `.env` gitignored | `.env.example` skeleton below; D-04 |
| DEPLOY-08 | README has copy-paste curl spin-up instructions | README template — copy-paste spin-up section |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

| Directive | Source | Affects |
|-----------|--------|---------|
| **Conventional Commits with emojis** (`✨ feat`, `🐛 fix`, `📝 docs`, `🔧 chore`, `🏗️ build`, `🔒️ security` etc.) | CLAUDE.md §"Git Commit Guidelines" | All commits Phase 1 produces |
| **NEVER include** `🤖 Generated with [Claude Code]` or `Co-Authored-By: Claude` lines | CLAUDE.md §"Important Rules" | Every commit message |
| Locked tech stack mirror — FastAPI 0.136.1 / uvicorn 0.47.0 / pydantic 2.13.4 / pydantic-settings 2.14.1 / langgraph 1.2.1 / psycopg[binary,pool] 3.3.4 / aio-pika 9.6.2 / qdrant-client 1.18.0 / langfuse 4.6.1 / uv 0.11.16 / ruff 0.15.14 / structlog 25.5.0 | CLAUDE.md §"Technology Stack" | `pyproject.toml` pins |
| `python:3.12-slim-bookworm` (NOT alpine, NOT 3.13) | CLAUDE.md §9 | Dockerfile base image |
| `asyncpg` is **forbidden** | CLAUDE.md §10 anti-recommendations | Lint rule D-17 |
| `langchain` meta-package forbidden — install only `langchain-core` + targeted provider packages | CLAUDE.md §10 | `pyproject.toml` deps |
| Pin every image to explicit version tag (no `:latest`) | CLAUDE.md §10 | All compose service images |
| Two Postgres containers (NOT shared) for Brain vs Langfuse | CLAUDE.md §10 | Compose topology |
| `gunicorn` in front of uvicorn forbidden — use `uvicorn --workers N` | CLAUDE.md §10 | Dockerfile CMD |

---

## Standard Stack

### Core (exact-pinned in `pyproject.toml`)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `fastapi` | `0.136.1` | Web framework | `[CITED: CLAUDE.md §1, STACK.md §1]` |
| `uvicorn[standard]` | `0.47.0` | ASGI server (use `--workers N`, no gunicorn) | `[CITED: CLAUDE.md §1]` |
| `pydantic` | `2.13.4` | Schema validation (v2 only) | `[CITED: CLAUDE.md §1]` |
| `pydantic-settings` | `2.14.1` | `.env` → typed `Settings` class | `[CITED: CLAUDE.md §1]` |
| `httpx` | `0.28.1` | Outbound HTTP + test client | `[CITED: CLAUDE.md §1]` |
| `langgraph` | `1.2.1` | Graph runtime | `[CITED: CLAUDE.md §2]` — **exact-pin (FOUND-02)** |
| `langgraph-checkpoint` | `4.1.0` | Base checkpoint interface (transitive, pin anyway) | `[CITED: CLAUDE.md §2]` — **exact-pin** |
| `langgraph-checkpoint-postgres` | `3.1.0` | `AsyncPostgresSaver` for `langgraph.*` schema | `[CITED: CLAUDE.md §2]` — **exact-pin** |
| `langchain-core` | `1.4.0` | Message types, runnables (required by checkpointer) | `[CITED: CLAUDE.md §2]` |
| `psycopg[binary,pool]` | `3.3.4` | Required by `langgraph-checkpoint-postgres`. **NOT asyncpg** | `[CITED: CLAUDE.md §3]` |
| `sqlalchemy` | `2.0.49` | ORM for `brain.*` schema (v2 async) | `[CITED: CLAUDE.md §3]` |
| `alembic` | `1.18.4` | Migrations for `brain.*` schema | `[CITED: CLAUDE.md §3]` |
| `aio-pika` | `9.6.2` | Async RabbitMQ client (Phase 1 imports for `/readyz`, full use Phase 8) | `[CITED: CLAUDE.md §6]` |
| `qdrant-client` | `1.18.0` | Async vector DB client (Phase 1 imports for `/readyz`, full use Phase 7) | `[CITED: CLAUDE.md §4]` |
| `structlog` | `25.5.0` | JSON structured logging | `[CITED: CLAUDE.md §8]` |

**Verification:** Versions are mirrored verbatim from CLAUDE.md, which was verified against PyPI on 2026-05-21 per STACK.md §12. `[VERIFIED: CLAUDE.md §11 compatibility table]` confirms `langgraph 1.2.1 + langgraph-checkpoint-postgres 3.1.0 + psycopg v3` is a tested triple.

### Supporting (Phase 1 may not need all, but pin now to lock the spine)

| Library | Version | Purpose | When |
|---------|---------|---------|------|
| `tenacity` | `9.1.4` | Retry policy (Phase 5 uses it; Phase 1 may use it for startup retries on Postgres) | Phase 1 optional |
| `tiktoken` | latest | OpenAI token counting | Phase 5 (do not import in Phase 1) |
| `langfuse` | `4.6.1` | Langfuse Python SDK (Phase 4 wires it; Phase 1 pins to lock matched server) | Phase 4 |
| `langchain-openai` | `1.2.2` | OpenAI provider | Phase 5 — DO NOT import in Phase 1 |
| `langchain-google-genai` | `4.2.3` | Gemini provider | Phase 5 — DO NOT import in Phase 1 |

### Dev / tooling (locked group)

| Library | Version | Purpose |
|---------|---------|---------|
| `uv` | `0.11.16` | Package + lockfile manager (installed in builder Docker stage from `ghcr.io/astral-sh/uv:latest` — pin a digest in production) |
| `ruff` | `0.15.14` | Lint + format (replaces black + isort + flake8) |
| `mypy` | latest stable | Type checking (CI gate) |
| `pytest` | `9.0.3` | Test runner |
| `pytest-asyncio` | `1.3.0` | Async test support |
| `pytest-cov` | latest | Coverage |
| `testcontainers[postgres,rabbitmq]` | latest | Integration tests (Phase 1 uses for compose-up smoke) |
| `gitleaks` | `8.x` (binary, not pypi) | Pre-commit secret scanner — install via `pre-commit` hook from `github.com/gitleaks/gitleaks` |

**Version verification (mandatory before locking):**

The planner MUST run these before writing the lockfile and document the verified version + date in PLAN.md:

```bash
npm view --json 2>/dev/null || true  # not applicable, Python project
# Python registry verifications:
uv pip install --dry-run langgraph==1.2.1 langgraph-checkpoint==4.1.0 langgraph-checkpoint-postgres==3.1.0 \
  fastapi==0.136.1 uvicorn==0.47.0 pydantic==2.13.4 pydantic-settings==2.14.1 \
  psycopg[binary,pool]==3.3.4 sqlalchemy==2.0.49 alembic==1.18.4 \
  aio-pika==9.6.2 qdrant-client==1.18.0 structlog==25.5.0 \
  pytest==9.0.3 pytest-asyncio==1.3.0 ruff==0.15.14
```

If any version is yanked or replaced, the planner must surface the diff before lock.

### Alternatives Considered (rejected for Phase 1)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Multi-stage uv Dockerfile | Single-stage `pip install` | Single-stage = ~3x larger image, no separation of build deps; rejected |
| `docker-compose.lite.yml` (separate file) | Compose `profiles:` | Profiles are one source of truth but DEPLOY-02 names the file. Two files = simpler mental model; **chosen** |
| `pyproject.toml` `^` ranges | Exact pins | FOUND-02 mandates exact pins on LangGraph triple; apply same discipline everywhere to avoid `uv lock` regen drift |
| Auto-generated correlation_id (asgi-correlation-id) | Hand-rolled middleware | asgi-correlation-id is well-maintained but adds one dep; hand-rolled = ~15 lines and zero supply-chain surface. Either is acceptable; planner picks |
| structlog `ProcessorFormatter` to merge uvicorn access logs | Disable uvicorn access logs entirely | Disabling loses access-log information; merging via `ProcessorFormatter` is the canonical 2026 pattern. **Chosen.** `[CITED: https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e]` |

### Installation

```bash
# Initialize project
uv init --package brain
uv add fastapi==0.136.1 'uvicorn[standard]==0.47.0' pydantic==2.13.4 pydantic-settings==2.14.1 \
       httpx==0.28.1 \
       langgraph==1.2.1 langgraph-checkpoint==4.1.0 langgraph-checkpoint-postgres==3.1.0 \
       langchain-core==1.4.0 \
       'psycopg[binary,pool]==3.3.4' sqlalchemy==2.0.49 alembic==1.18.4 \
       aio-pika==9.6.2 qdrant-client==1.18.0 structlog==25.5.0
uv add --dev pytest==9.0.3 pytest-asyncio==1.3.0 pytest-cov ruff==0.15.14 mypy \
             'testcontainers[postgres,rabbitmq]'
uv lock
```

---

## Architecture Patterns

### Recommended Project Structure

```
brain/
├── src/brain/
│   ├── api/             # FastAPI routers; Phase 3 wires /v1/webhook. Phase 1 ships /healthz, /readyz, app factory
│   │   ├── __init__.py
│   │   ├── README.md
│   │   ├── app.py       # FastAPI factory + lifespan
│   │   ├── health.py    # /healthz, /readyz routers
│   │   └── middleware.py# request_id middleware (Phase 1); auth/size middleware (Phase 3 fills)
│   ├── workers/         # Phase 8: aio-pika consumer. Phase 1: empty stub README
│   ├── service/         # Phase 3: BrainService shared waist. Phase 1: empty stub README
│   ├── graph/           # LangGraph nodes. Phase 1 ships ONLY thread_id helper
│   │   ├── __init__.py
│   │   ├── README.md
│   │   └── thread.py    # thread_id(bot_id, session_id) -> str  (FOUND-08)
│   ├── providers/       # Phase 5
│   ├── memory/          # Phase 6 & 7
│   ├── personas/        # Phase 2
│   ├── vectordb/        # Phase 7
│   ├── db/              # Phase 1: psycopg pool, AsyncPostgresSaver factory, migrate entrypoint
│   │   ├── __init__.py
│   │   ├── README.md
│   │   ├── pool.py      # AsyncConnectionPool wrapper (lifespan-managed)
│   │   ├── checkpointer.py # AsyncPostgresSaver factory (used by brain-migrate)
│   │   └── migrate.py   # brain-migrate entrypoint: alembic upgrade + checkpointer.setup()
│   ├── config/          # Phase 1: Pydantic Settings, schema_version helper, logging
│   │   ├── __init__.py
│   │   ├── README.md
│   │   ├── settings.py  # Settings(BaseSettings) + sub-models
│   │   ├── schema_version.py  # field_validator helper for BrainRequest (Phase 3 imports)
│   │   └── logging.py   # structlog + uvicorn integration
│   └── observability/   # Phase 4
├── tests/
│   ├── conftest.py
│   ├── test_settings.py
│   ├── test_health.py
│   ├── test_schema_version.py
│   ├── test_thread_id.py
│   └── smoke/
│       └── test_compose_up.py  # Optional CI smoke
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── docker/
│   ├── Dockerfile        # multi-stage base→dev→prod
│   └── entrypoints/
│       └── migrate.sh    # used by brain-migrate init container
├── docker-compose.yml          # full stack (10 services)
├── docker-compose.lite.yml     # inner-loop subset (5 services, no Langfuse)
├── pyproject.toml
├── uv.lock
├── alembic.ini
├── .env.example
├── .env                  # gitignored
├── .gitignore
├── .gitleaks.toml
├── .gitleaksignore        # empty for now
├── .pre-commit-config.yaml
├── .github/workflows/
│   └── ci.yml            # ruff + mypy + pytest + gitleaks
└── README.md
```

### Pattern 1: Active `/readyz` probe with bounded per-dep timeout + short cache

**What:** `/readyz` actively pokes Postgres + RabbitMQ + Qdrant; each probe is wrapped in `asyncio.wait_for(timeout=2.0)`. A 5-second in-process result cache prevents probe storms during health-check loops.

**When:** Always — D-05 mandates active probes.

**Example** (canonical shape):

```python
# Source: composed from FastAPI docs + aio-pika + qdrant-client patterns
# src/brain/api/health.py
from __future__ import annotations
import asyncio
import time
from typing import Literal, TypedDict
from fastapi import APIRouter, Response, status

router = APIRouter()

class ReadyCheck(TypedDict):
    postgres: Literal["ok", "timeout", "error"]
    rabbitmq: Literal["ok", "timeout", "error"]
    qdrant: Literal["ok", "timeout", "error"]

_cache: tuple[float, ReadyCheck] | None = None
_CACHE_TTL_S = 5.0
_PROBE_TIMEOUT_S = 2.0

async def _probe_postgres(pool) -> str:
    async with pool.connection() as conn:
        await conn.execute("SELECT 1")
    return "ok"

async def _probe_rabbitmq(connection) -> str:
    if connection.is_closed:
        return "error"
    ch = await connection.channel()  # open + close: cheap liveness
    await ch.close()
    return "ok"

async def _probe_qdrant(client) -> str:
    # qdrant-client AsyncQdrantClient has .healthz() since 1.6.1
    await client.healthz()
    return "ok"

async def _run_probe(coro) -> str:
    try:
        return await asyncio.wait_for(coro, timeout=_PROBE_TIMEOUT_S)
    except asyncio.TimeoutError:
        return "timeout"
    except Exception:
        return "error"

@router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}

@router.get("/readyz")
async def readyz(response: Response, *, pool, rabbit_conn, qdrant) -> dict:
    global _cache
    now = time.monotonic()
    if _cache and (now - _cache[0]) < _CACHE_TTL_S:
        checks = _cache[1]
    else:
        pg, mq, qd = await asyncio.gather(
            _run_probe(_probe_postgres(pool)),
            _run_probe(_probe_rabbitmq(rabbit_conn)),
            _run_probe(_probe_qdrant(qdrant)),
        )
        checks = ReadyCheck(postgres=pg, rabbitmq=mq, qdrant=qd)
        _cache = (now, checks)
    if all(v == "ok" for v in checks.values()):
        return {"status": "ready", "checks": checks}
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "not_ready", "checks": checks}
```

`[VERIFIED: qdrant-client docs — AsyncQdrantClient.healthz() exists since 1.6.1]` `[CITED: https://python-client.qdrant.tech/qdrant_client.async_qdrant_client]`
`[CITED: aio-pika robust connection — `connection.is_closed` is the canonical liveness signal; channel-open/close is a cheap channel probe]`

### Pattern 2: Pydantic Settings with nested sub-models, env prefix `BRAIN_`, delimiter `__`

**What:** One top-level `Settings(BaseSettings)` aggregating typed sub-models. Env vars look like `BRAIN_POSTGRES__DSN=...`. Validation runs at startup and fail-fasts before uvicorn binds the socket.

**When:** Always — FOUND-04, FOUND-05.

**Example:**

```python
# Source: pydantic-settings 2.14 docs
# src/brain/config/settings.py
from __future__ import annotations
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class PostgresSettings(BaseModel):
    dsn: str  # postgresql://brain:brain@brain-postgres:5432/brain
    pool_min: int = 2
    pool_max: int = 10

class RabbitMQSettings(BaseModel):
    url: str  # amqp://brain:brain@rabbitmq:5672/
    prefetch: int = 1  # PITFALL 4.2

class QdrantSettings(BaseModel):
    url: str  # http://qdrant:6333
    api_key: str | None = None

class LangfuseSettings(BaseModel):
    host: str = "http://langfuse-web:3000"
    public_key: str = ""
    secret_key: str = ""
    enabled: bool = False  # Phase 4 flips to True

class AuthSettings(BaseModel):
    token: str  # BRAIN_AUTH_TOKEN — required, no default

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BRAIN_",
        env_nested_delimiter="__",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="forbid",
    )

    # Service
    env: str = "development"
    log_format: str = "json"  # json | console
    log_level: str = "INFO"
    shutdown_grace_seconds: int = 30
    supported_schema_versions: list[int] = [1]

    # Sub-models
    postgres: PostgresSettings
    rabbitmq: RabbitMQSettings
    qdrant: QdrantSettings
    langfuse: LangfuseSettings = LangfuseSettings()
    auth: AuthSettings


def get_settings() -> Settings:
    return Settings()  # raises ValidationError at startup if anything missing
```

**Gotchas:**

- Sub-models MUST inherit from `pydantic.BaseModel` (NOT `BaseSettings`). `[CITED: pydantic-settings docs]`
- `extra="forbid"` makes typos in `.env` raise instead of silently ignored.
- Defaults are validated by default in v2 — `BRAIN_SUPPORTED_SCHEMA_VERSIONS=1,2` parses to `[1, 2]` automatically.
- `BRAIN_AUTH_TOKEN` has no default — missing it raises `ValidationError` at startup (FOUND-05).
- `env_nested_delimiter="__"` was chosen (not `_`) because field names like `pool_min` contain underscores. `[CITED: pydantic-settings docs — delimiter collision warning]`

### Pattern 3: Dual Postgres schemas — `langgraph.*` + `brain.*` — single init container

**What:** A single `brain-migrate` container runs Alembic against `brain.*` then calls `AsyncPostgresSaver.setup()` to create `langgraph.*`. Both schemas live in one Postgres instance (`brain-postgres`). Brain workers depend on `condition: service_completed_successfully`.

**When:** Always — D-07, FOUND-07, PITFALL 6.1, PITFALL 7.2.

**Example — Alembic env.py with schema filter:**

```python
# Source: Alembic multi-schema pattern
# alembic/env.py (excerpt)
from alembic import context
from sqlalchemy import engine_from_config, pool

target_metadata = ...  # SQLAlchemy MetaData(schema="brain")

def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name == "brain"  # do NOT manage langgraph schema
    return True

def run_migrations_online() -> None:
    connectable = engine_from_config(...)
    with connectable.connect() as connection:
        # Ensure schema exists before version table is created
        connection.execute("CREATE SCHEMA IF NOT EXISTS brain")
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="brain",
            include_schemas=True,
            include_name=include_name,
        )
        with context.begin_transaction():
            context.run_migrations()
```

`[CITED: Alembic multi-schema docs — version_table_schema + include_schemas + include_name pattern]`

**Example — brain-migrate entrypoint:**

```python
# Source: composed from langgraph-checkpoint-postgres docs + Alembic CLI
# src/brain/db/migrate.py
"""Init-container entrypoint: alembic upgrade then AsyncPostgresSaver.setup().

Run via:
    python -m brain.db.migrate

Exits 0 on success, non-zero on failure.
"""
from __future__ import annotations
import asyncio
import subprocess
import sys
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from brain.config.settings import get_settings


async def _setup_langgraph(dsn: str) -> None:
    async with AsyncPostgresSaver.from_conn_string(dsn) as saver:
        await saver.setup()


def main() -> int:
    settings = get_settings()
    # Step 1: Alembic — brain.* schema
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        check=False,
    )
    if result.returncode != 0:
        print(f"Alembic upgrade failed: {result.returncode}", file=sys.stderr)
        return result.returncode
    # Step 2: AsyncPostgresSaver — langgraph.* schema (idempotent)
    asyncio.run(_setup_langgraph(settings.postgres.dsn))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`[VERIFIED: AsyncPostgresSaver.from_conn_string applies autocommit=True, prepare_threshold=0, row_factory=dict_row internally]` `[CITED: https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver]`
`[VERIFIED: AsyncPostgresSaver.setup() is idempotent — safe to re-run across restarts]` `[CITED: https://pypi.org/project/langgraph-checkpoint-postgres/]`

**`langgraph.*` schema note:** `AsyncPostgresSaver.setup()` creates the checkpointer tables in the `public` schema by default. To force them into the `langgraph.*` schema, set the search path on the connection string: `postgresql://brain:brain@brain-postgres:5432/brain?options=-csearch_path%3Dlanggraph` OR `CREATE SCHEMA IF NOT EXISTS langgraph` first and run the setup with an explicit `SET search_path TO langgraph`. **[ASSUMED]** — the planner should verify behavior of `.setup()` against schema-prefixing in `langgraph-checkpoint-postgres` 3.1.0 release notes; if `.setup()` ignores search_path, an alternative is to create the schema and use `pg_dump` to confirm tables land in the right namespace before declaring Phase 1 done. This is the single most likely source of "it works on my machine" surprises.

### Pattern 4: Multi-stage uv Dockerfile (base → dev → prod)

**What:** Three stages in one file. Builder installs uv and dependencies into a venv with cache mounts. Prod stage copies only the venv + source into a fresh `python:3.12-slim-bookworm`, runs as non-root, declares HEALTHCHECK against `/healthz`.

**When:** Always — DEPLOY-03.

**Example:**

```dockerfile
# Source: https://docs.astral.sh/uv/guides/integration/docker/  (canonical)
# Dockerfile

# ───── Stage 1: builder ─────
FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Install deps (no source yet → cacheable layer)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# Copy source, install project itself
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ───── Stage 2: dev (adds dev deps) ─────
FROM builder AS dev
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen
ENV PATH="/app/.venv/bin:$PATH"
CMD ["uvicorn", "brain.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ───── Stage 3: prod ─────
FROM python:3.12-slim-bookworm AS prod
RUN groupadd --system --gid 1001 brain \
 && useradd  --system --uid 1001 --gid brain --home-dir /app --shell /sbin/nologin brain

COPY --from=builder --chown=brain:brain /app/.venv /app/.venv
COPY --from=builder --chown=brain:brain /app/src   /app/src
COPY --from=builder --chown=brain:brain /app/alembic /app/alembic
COPY --from=builder --chown=brain:brain /app/alembic.ini /app/alembic.ini
COPY --from=builder --chown=brain:brain /app/pyproject.toml /app/pyproject.toml

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER brain
EXPOSE 8000

# HEALTHCHECK hits the loopback /healthz (liveness only — readyz would 503 if MQ flaps)
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2).status==200 else 1)"

CMD ["uvicorn", "brain.api.app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--timeout-graceful-shutdown", "30"]
```

`[CITED: https://docs.astral.sh/uv/guides/integration/docker/ — UV_LINK_MODE=copy required when cache mount lives on a different filesystem; UV_COMPILE_BYTECODE for production startup speed; --frozen pins to uv.lock]`

**Notes:**

- `--workers 1` is intentional (ARCHITECTURE.md §Concurrency: persona cache + lock registry are in-process). Horizontal scale = more containers, not more workers.
- `--timeout-graceful-shutdown 30` matches `BRAIN_SHUTDOWN_GRACE_SECONDS`. Uvicorn's CLI flag has no default — leaving it unset means uvicorn waits indefinitely on a stuck request during shutdown. `[CITED: https://www.uvicorn.org/server-behavior/]`
- HEALTHCHECK uses Python stdlib (no curl/wget needed in the slim image).
- `brain-migrate` reuses this same image with `CMD ["python", "-m", "brain.db.migrate"]` — no separate Dockerfile.

### Pattern 5: FastAPI lifespan + uvicorn SIGTERM = graceful shutdown

**What:** `lifespan` async context manager opens psycopg pool + AMQP connection + Qdrant client at startup, closes them in reverse order at shutdown. uvicorn handles SIGTERM by closing the listening socket, waiting for in-flight requests to finish, then unwinding the lifespan. `--timeout-graceful-shutdown` caps the wait.

**When:** Always — FOUND-09, D-13.

**Example:**

```python
# Source: FastAPI lifespan docs + aio-pika/psycopg/qdrant-client patterns
# src/brain/api/app.py
from __future__ import annotations
import contextlib
from typing import AsyncIterator
from fastapi import FastAPI
import structlog
from psycopg_pool import AsyncConnectionPool
import aio_pika
from qdrant_client import AsyncQdrantClient

from brain.api.health import router as health_router
from brain.api.middleware import RequestIDMiddleware
from brain.config.settings import get_settings
from brain.config.logging import configure_logging


log = structlog.get_logger(__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)

    # ─── Startup ───
    pool = AsyncConnectionPool(conninfo=settings.postgres.dsn,
                               min_size=settings.postgres.pool_min,
                               max_size=settings.postgres.pool_max,
                               open=False)
    await pool.open()

    rabbit_conn = await aio_pika.connect_robust(settings.rabbitmq.url)
    qdrant = AsyncQdrantClient(url=settings.qdrant.url, api_key=settings.qdrant.api_key)

    app.state.pool = pool
    app.state.rabbit = rabbit_conn
    app.state.qdrant = qdrant
    app.state.settings = settings

    log.info("startup_complete", service="brain")
    try:
        yield
    finally:
        # ─── Shutdown (reverse order) ───
        log.info("shutdown_begin", service="brain")
        await qdrant.close()
        await rabbit_conn.close()
        await pool.close()
        log.info("shutdown_complete", service="brain")


def create_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan, title="Brain", version="0.1.0")
    app.add_middleware(RequestIDMiddleware)
    app.include_router(health_router)
    return app


app = create_app()
```

`[CITED: uvicorn server behavior — on SIGTERM, uvicorn closes the listening socket, waits for in-flight responses, then exits. `--timeout-graceful-shutdown` is the upper bound. No default — set explicitly.]`
`[CITED: FastAPI lifespan docs — body before yield = startup, body after yield = shutdown, exceptions in startup prevent uvicorn from binding the port]`

### Anti-Patterns to Avoid (Phase 1 specific)

- **Compose `:latest` tags** — every image must be pinned to an explicit tag (CLAUDE.md §10). Use Renovate or Dependabot in a later phase to surface bumps; never `:latest`.
- **Single-stage Dockerfile** — bloats prod image, exposes uv binary + build tools.
- **`gunicorn -k uvicorn.workers.UvicornWorker`** — explicitly banned (CLAUDE.md §10). Use `uvicorn --workers N` directly.
- **`os.getenv` scattered across modules** — all env access flows through `get_settings()`. Pre-commit grep ban is overkill for Phase 1 but worth a code-review checklist item.
- **`print` for "just a debug line"** — ruff `T201` catches it. The pre-commit grep is the belt-and-suspenders.
- **`docker compose down -v` documented as default reset** — README must say `down` only; `-v` is destructive (PITFALL 6.3).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Env loading + validation | Custom `os.getenv` + manual type casting | `pydantic-settings 2.14` | Validates at startup, fails fast, provides typed access, handles `.env` automatically |
| JSON structured logging | Custom JSON formatter on stdlib `logging` | `structlog 25.5` + `ProcessorFormatter` for stdlib bridging | structlog is the canonical 2026 choice; uvicorn's stdlib logs route through the same pipeline via `ProcessorFormatter` |
| Per-request correlation ID | Generating UUIDs in random places | structlog `contextvars` + tiny middleware | `bind_contextvars(request_id=...)` propagates through async tasks automatically |
| Graceful shutdown signal handling | `signal.signal(SIGTERM, ...)` | uvicorn `--timeout-graceful-shutdown` + FastAPI `lifespan` | uvicorn already handles SIGTERM correctly; signal handlers fight uvicorn |
| Secret scanning in CI | grep for `OPENAI_API_KEY=...` | `gitleaks 8.x` | Maintained ruleset; both pre-commit and CI shapes; one binary, no Python deps |
| Multi-schema Alembic config | Hand-edit `alembic_version` table position | `version_table_schema="brain" + include_schemas=True + include_name` filter | Standard Alembic pattern; avoids accidentally "managing" `langgraph.*` tables |
| Python package install in Docker | `pip install -r requirements.txt` | `uv sync --frozen --no-dev` + multi-stage | 10-100x faster, layer cache friendly, exact lockfile semantics |
| Healthcheck script in container | Shell `curl http://...` | `python -c "import urllib.request..."` | Slim image has no curl; stdlib has urllib |
| Compose service-ordering | `sleep N` in entrypoints | `depends_on: condition: service_healthy` + `service_completed_successfully` | Native Compose, deterministic, no race |
| Custom checkpointer wrapper | Hand-roll on top of psycopg | `AsyncPostgresSaver.from_conn_string` | Sets autocommit + prepare_threshold + row_factory correctly; setup() is idempotent |

**Key insight:** Phase 1 has zero business logic. Every line of code that isn't gluing supported libraries together is a future maintenance liability. If it feels like you're writing more than a hundred lines for any of the above bullets, you're doing it wrong.

---

## Runtime State Inventory

**Phase 1 is greenfield — no prior runtime state to migrate.** Documenting categories explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — fresh repo, no databases provisioned yet | None |
| Live service config | None — no n8n / Datadog / Tailscale / etc. integrations | None |
| OS-registered state | None — no systemd / Task Scheduler / launchd registrations | None |
| Secrets/env vars | None pre-existing; Phase 1 introduces `.env` with placeholders. SOPS / Doppler / 1Password integration deferred to Phase 9 (D-18 + STATE.md "Hardening") | None for Phase 1 |
| Build artifacts | None — no existing wheels / eggs / Docker images | None |

**Verified by:** `git ls-files | wc -l` shows only `.planning/` and `CLAUDE.md`; `docker ps -a` is empty on the target dev box (assumed); no infrastructure was provisioned before this phase.

---

## Common Pitfalls

### Pitfall 1: `langgraph-checkpoint-postgres` minor version drifts on `uv lock` regen

**What goes wrong:** A future `uv lock` regenerate bumps `langgraph-checkpoint-postgres` from 3.1.0 → 3.2.x. The minor version changes checkpoint metadata serialization. Old checkpoints become unreadable.

**Why it happens:** PITFALL 1.1 — historical precedent (langgraph-checkpoint-postgres 2.0.21 → 2.0.22 broke metadata serialization).

**How to avoid:** Exact-pin in `pyproject.toml` (FOUND-02). NO `^`, NO `~`. Phase 6 will add the legacy-checkpoint replay fixture test (D-08). Phase 1 just locks the pins.

**Warning signs:** A `uv lock` diff shows the LangGraph triple changing without an intentional PR. Block in CI: `git diff --name-only HEAD~1 HEAD | grep -q uv.lock && grep -E 'langgraph(-checkpoint(-postgres)?)?' uv.lock` triggers a manual review label.

### Pitfall 2: `AsyncPostgresSaver.setup()` writes to `public` schema, not `langgraph.*`

**What goes wrong:** Planner assumes `.setup()` honors a schema name like Alembic's `version_table_schema`. It doesn't — `setup()` creates `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations` in whatever schema the connection's `search_path` points to (default: `public`).

**Why it happens:** Asymmetry between LangGraph's "owns its tables" stance and Alembic's "owns its tables" stance — both assume their tables sit somewhere reasonable. `langgraph-checkpoint-postgres` does not expose a schema parameter as of 3.1.0.

**How to avoid:** Either (a) connect with `?options=-csearch_path%3Dlanggraph` in the DSN passed to `from_conn_string`, OR (b) `CREATE SCHEMA IF NOT EXISTS langgraph; SET search_path TO langgraph;` immediately before `setup()` and assert table presence afterwards. The migrate entrypoint should verify with `SELECT to_regclass('langgraph.checkpoints')` before exiting 0.

**Warning signs:** After `brain-migrate` completes, `psql -c '\dn'` shows only `public` + `brain`, no `langgraph`. Or `\dt langgraph.*` returns "Did not find any relation." The fix is in DSN/search_path, not in the migrate logic.

**Confidence:** `[ASSUMED]` — `langgraph-checkpoint-postgres` 3.1.0 release notes were not directly inspected for a `schema` parameter; the planner must verify against the actual installed package source. This is **Assumption A1** in the Assumptions Log.

### Pitfall 3: Langfuse compose subsystem starts before Brain — Brain hangs waiting for it

**What goes wrong:** Despite D-11 keeping Langfuse out of Brain's `depends_on`, a developer naively pastes upstream Langfuse compose snippets that include `depends_on: langfuse-web` on Brain. Brain blocks on Langfuse's 5-sidecar boot (ClickHouse takes >1 minute on first run).

**Why it happens:** Convenience: copy-paste from Langfuse self-hosting docs.

**How to avoid:** Document the rule in `docker-compose.yml` itself with a comment block above the `brain:` service: `# Brain MUST NOT depends_on any langfuse-* service. See PITFALL 8.1.` A pre-commit grep against `docker-compose.yml` for `langfuse` inside Brain's `depends_on` block is overkill; the comment + code review is enough.

**Warning signs:** `docker compose up` takes >90 seconds before `/healthz` returns 200 on a warm cache (Brain stage should be <20s). `docker compose logs brain` shows `waiting for langfuse-web`.

### Pitfall 4: `.env.example` checked in with real keys "just for testing"

**What goes wrong:** Dev fills `.env.example` with their real OpenAI key and commits. Gitleaks catches it in CI but it's already on the branch.

**Why it happens:** Confusing `.env.example` (committed) with `.env` (gitignored).

**How to avoid:**
1. `.env.example` ships **real working dev defaults for internal infrastructure** (D-04) — `brain:brain` for Postgres, `guest:guest` for RabbitMQ — these are not secrets.
2. External provider keys ship as `<REPLACE_ME>` placeholders (D-04).
3. Pre-commit gitleaks catches real-looking strings before commit even if a dev mistakenly edits `.env.example` with a real key.
4. `gitleaks` `.gitleaks.toml` has explicit rules for `OPENAI_API_KEY`, `GEMINI_API_KEY`, `BRAIN_AUTH_TOKEN` patterns.

**Warning signs:** Gitleaks reports a hit on a commit; the file is `.env.example` instead of `.env`.

### Pitfall 5: structlog config double-formats uvicorn access logs

**What goes wrong:** structlog wraps everything, uvicorn's `--access-log` flag also formats lines → you get JSON wrapping JSON (or formatted strings wrapping JSON).

**Why it happens:** Both structlog and uvicorn's default access logger handle records independently.

**How to avoid:** Route uvicorn's stdlib loggers through structlog's `ProcessorFormatter`. The nymous gist pattern (cited below) is canonical: disable uvicorn's default access-log formatter, install a stdlib `logging.dictConfig` that pipes `uvicorn.access`, `uvicorn.error`, and the root logger to a structlog `ProcessorFormatter` with the same processor chain as native structlog calls. Verify in a unit test: capture stdout during a test request, parse every line as JSON, assert no line raises `json.JSONDecodeError`.

**Confidence:** `[CITED: https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e]`

### Pitfall 6: Pydantic Settings `extra="forbid"` rejects unknown env vars from CI runners

**What goes wrong:** GitHub Actions injects dozens of `GITHUB_*` env vars. With `extra="forbid"` and `env_prefix="BRAIN_"`, those don't conflict — but if a contributor sets `BRAIN_DEBUG=1` ad-hoc and that field doesn't exist on `Settings`, the app fails to start.

**Why it happens:** `extra="forbid"` is strict by design.

**How to avoid:** Keep `extra="forbid"` (it catches typos in `.env`). Add `BRAIN_DEBUG: bool = False` to `Settings` if devs commonly want it. Document the rule: "If you need a new env var, add a field to `Settings` first."

### Pitfall 7: `docker-compose.lite.yml` drifts from `docker-compose.yml`

**What goes wrong:** Adding a new env var or healthcheck to the full compose file but not the lite file. CI runs against full, dev runs lite, they diverge.

**Why it happens:** Two files = two places to update.

**How to avoid:** A small CI step that diffs the `brain`, `brain-migrate`, `brain-postgres`, `rabbitmq`, `qdrant` service definitions across the two files (after YAML-canonicalize) and fails on a drift not explicitly allowed. Phase 1 can ship a `scripts/check-compose-parity.sh` that the CI pipeline runs.

### Pitfall 8: MinIO image is archived — pinning `:latest` is silent rot

**What goes wrong:** Upstream MinIO archived their community Docker images in early 2026. `minio/minio:latest` may still resolve via Docker Hub cache but no new security updates ship. The Langfuse subsystem becomes a long-tail liability.

**Why it happens:** Industry-level change in upstream maintenance.

**How to avoid:**
1. Pin MinIO to a specific pre-archive RELEASE tag (e.g., `minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1`). `[CITED: hub.docker.com/r/minio/minio/tags]`
2. Document in README: "MinIO image is the last community release; v1.x will migrate to Garage or SeaweedFS."
3. Open a tracking issue / TODO in STATE.md under "Open Questions" — see `## Open Questions` below.

**Warning signs:** Security scan flags CVEs in `minio/minio:latest`; `docker pull minio/minio:latest` returns an image last updated >180 days ago. None of these block Phase 1.

---

## Code Examples

Verified patterns ready for the planner to reference. Each example cites its source.

### Example 1: `thread_id` helper + grep ban (FOUND-08)

```python
# Source: PITFALL 10.1 + CONTEXT.md D-17
# src/brain/graph/thread.py
"""LangGraph thread_id helper.

CRITICAL: `thread_id` must ALWAYS combine bot_id and session_id (PITFALL 10.1).
Bare session_id collides across bots and leaks conversation history.
This module is the ONLY sanctioned way to construct a thread_id.
"""
from __future__ import annotations

_SEP = ":"


def thread_id(bot_id: str, session_id: str) -> str:
    """Return the canonical LangGraph thread_id for a (bot, session) pair.

    Args:
        bot_id: opaque bot identifier (e.g., "wa-vendas")
        session_id: opaque session identifier (e.g., user phone or chat id)

    Returns:
        f"{bot_id}:{session_id}" — used verbatim as the LangGraph thread_id
        and as the lock-registry key.

    Raises:
        ValueError: if either argument is empty or contains the separator.
    """
    if not bot_id or not session_id:
        raise ValueError("bot_id and session_id must both be non-empty")
    if _SEP in bot_id or _SEP in session_id:
        raise ValueError(f"bot_id and session_id must not contain {_SEP!r}")
    return f"{bot_id}{_SEP}{session_id}"
```

**Lint ban (pre-commit hook):**

```yaml
# .pre-commit-config.yaml (excerpt)
- repo: local
  hooks:
    - id: ban-raw-thread-id
      name: Ban raw f"{bot_id}:{session_id}" outside thread.py
      entry: bash -c '
        set -e
        if git diff --cached --name-only | grep -E "^src/brain/.*\.py$" | grep -v "src/brain/graph/thread.py" > /tmp/files; then
          while read -r f; do
            if grep -E "f\"\\{.*\\}:\\{.*\\}\"|f.'.+:.+.'" "$f" > /dev/null 2>&1; then
              echo "ERROR: raw thread_id construction in $f — use brain.graph.thread.thread_id()" >&2
              exit 1
            fi
          done < /tmp/files
        fi
      '
      language: system
      pass_filenames: false
```

### Example 2: `schema_version` Pydantic field_validator helper (FOUND-11)

```python
# Source: pydantic v2 docs + D-16
# src/brain/config/schema_version.py
"""schema_version validator helper.

Phase 1 ships the helper.
Phase 3 attaches it to `BrainRequest` via `Annotated[int, AfterValidator(...)]`.
"""
from __future__ import annotations
from typing import Any

from pydantic import AfterValidator

from brain.config.settings import get_settings


def _validate_schema_version(v: int) -> int:
    supported = get_settings().supported_schema_versions
    if v not in supported:
        # Surfaced by FastAPI as 422 with code UNSUPPORTED_SCHEMA_VERSION
        # (error envelope handler is added in Phase 3)
        raise ValueError(
            f"schema_version {v!r} not in supported versions {supported!r}"
        )
    return v


SchemaVersion = AfterValidator(_validate_schema_version)
```

**Phase-3 usage (documented but NOT written in Phase 1):**

```python
# Phase 3 — DO NOT include in Phase 1
from typing import Annotated
from brain.config.schema_version import SchemaVersion

class BrainRequest(BaseModel):
    schema_version: Annotated[int, SchemaVersion]
    botId: str
    sessionId: str
    conteudo: str
```

### Example 3: structlog + uvicorn JSON logging integration

```python
# Source: https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e (canonical 2026 pattern)
# src/brain/config/logging.py
from __future__ import annotations
import logging
import logging.config
import sys
import structlog
from brain.config.settings import Settings


def configure_logging(settings: Settings) -> None:
    """Wire structlog + stdlib so uvicorn access/error logs use the same processor chain."""
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,   # binds request_id, bot_id, session_id, trace_id
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        timestamper,
    ]

    if settings.log_format == "json":
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
        shared_processors.append(structlog.processors.format_exc_info)
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=shared_processors + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Route stdlib logs (uvicorn.access, uvicorn.error, alembic) through structlog
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    root_handler = logging.StreamHandler(sys.stdout)
    root_handler.setFormatter(formatter)
    logging.basicConfig(level=settings.log_level, handlers=[root_handler], force=True)

    # Silence noisy loggers that aren't useful in JSON mode
    for noisy in ("uvicorn", "uvicorn.access", "uvicorn.error", "httpx", "httpcore"):
        logging.getLogger(noisy).handlers = []
        logging.getLogger(noisy).propagate = True
```

### Example 4: Request-ID middleware binding context

```python
# Source: structlog contextvars docs + nymous gist
# src/brain/api/middleware.py
from __future__ import annotations
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
import structlog


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        structlog.contextvars.clear_contextvars()
        req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(
            request_id=req_id,
            service="brain",
            ingress="http",
            # placeholders updated by Phase 3 / Phase 4 once available
            bot_id="-",
            session_id="-",
            trace_id="-",
            schema_version="-",
        )
        response = await call_next(request)
        response.headers["x-request-id"] = req_id
        return response
```

### Example 5: `.gitleaks.toml` + pre-commit + CI

```toml
# .gitleaks.toml
[extend]
useDefault = true

[[rules]]
id = "brain-auth-token"
description = "Brain Bearer auth token"
regex = '''BRAIN_AUTH_TOKEN\s*=\s*[A-Za-z0-9_\-]{16,}'''
tags = ["secret", "brain"]

[[rules]]
id = "openai-key"
description = "OpenAI API key"
regex = '''sk-[A-Za-z0-9]{20,}'''
tags = ["secret", "openai"]

[[rules]]
id = "gemini-key"
description = "Google Gemini API key"
regex = '''AIza[0-9A-Za-z\-_]{35}'''
tags = ["secret", "gemini"]

[allowlist]
description = "Allowlist for example placeholders"
regexes = [
  '''<REPLACE_ME>''',
  '''replace-me-with-a-long-random-string''',
]
paths = [
  '''\.env\.example$''',
  '''README\.md$''',
]
```

```yaml
# .pre-commit-config.yaml (gitleaks portion)
- repo: https://github.com/gitleaks/gitleaks
  rev: v8.21.2   # planner: bump to current 8.x at planning time
  hooks:
    - id: gitleaks
      args: ["protect", "--staged", "--config", ".gitleaks.toml"]
```

```yaml
# .github/workflows/ci.yml (gitleaks portion)
gitleaks:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        GITLEAKS_CONFIG: .gitleaks.toml
```

`[CITED: gitleaks docs — `protect --staged` is the pre-commit shape; `detect --redact` is the CI shape; config precedence: --config flag > GITLEAKS_CONFIG env > .gitleaks.toml in target path]`

### Example 6: ruff config for T201 + G004 (FOUND-10 / D-15)

```toml
# pyproject.toml (excerpt)
[tool.ruff]
target-version = "py312"
line-length = 100
extend-exclude = ["alembic/versions"]

[tool.ruff.lint]
select = [
  "E",     # pycodestyle errors
  "F",     # pyflakes
  "W",     # pycodestyle warnings
  "I",     # isort
  "B",     # flake8-bugbear
  "T201",  # print  ← FOUND-10 ban
  "G004",  # logging f-string  ← FOUND-10 ban
  "UP",    # pyupgrade
  "RUF",   # ruff-native
]
# alembic/env.py is allowed to use stdlib logging (D-15 exception)
[tool.ruff.lint.per-file-ignores]
"alembic/env.py" = ["G004", "T201"]
"tests/**/*.py" = ["T201"]  # tests may use print for debugging
```

`[CITED: https://docs.astral.sh/ruff/rules/print/ — T201 is current and stable in 0.15.x]`
`[CITED: https://docs.astral.sh/ruff/rules/logging-f-string/ — G004 is current; pairs naturally with T201]`

### Example 7: `.env.example` skeleton (D-04)

```bash
# .env.example
# ─────────── Service ───────────
BRAIN_ENV=development
BRAIN_LOG_FORMAT=json
BRAIN_LOG_LEVEL=INFO
BRAIN_SHUTDOWN_GRACE_SECONDS=30
BRAIN_SUPPORTED_SCHEMA_VERSIONS=1

# ─────────── Auth ───────────
BRAIN_AUTH__TOKEN=<REPLACE_ME>

# ─────────── Postgres (Brain) ───────────
BRAIN_POSTGRES__DSN=postgresql://brain:brain@brain-postgres:5432/brain
BRAIN_POSTGRES__POOL_MIN=2
BRAIN_POSTGRES__POOL_MAX=10

# ─────────── RabbitMQ ───────────
BRAIN_RABBITMQ__URL=amqp://brain:brain@rabbitmq:5672/
BRAIN_RABBITMQ__PREFETCH=1

# ─────────── Qdrant ───────────
BRAIN_QDRANT__URL=http://qdrant:6333
BRAIN_QDRANT__API_KEY=

# ─────────── Langfuse (Phase 4 turns on; Phase 1 wires it) ───────────
BRAIN_LANGFUSE__HOST=http://langfuse-web:3000
BRAIN_LANGFUSE__PUBLIC_KEY=
BRAIN_LANGFUSE__SECRET_KEY=
BRAIN_LANGFUSE__ENABLED=false

# ─────────── Provider keys (filled by integrator) ───────────
OPENAI_API_KEY=<REPLACE_ME>
GEMINI_API_KEY=<REPLACE_ME>

# ─────────── Langfuse subsystem secrets (must change before prod) ───────────
LANGFUSE_NEXTAUTH_SECRET=<REPLACE_ME_64_CHAR_RANDOM>
LANGFUSE_SALT=<REPLACE_ME_64_CHAR_RANDOM>
LANGFUSE_ENCRYPTION_KEY=<REPLACE_ME_64_CHAR_HEX>
LANGFUSE_POSTGRES_PASSWORD=langfuse
LANGFUSE_CLICKHOUSE_PASSWORD=langfuse
LANGFUSE_MINIO_ROOT_USER=minio
LANGFUSE_MINIO_ROOT_PASSWORD=miniominio
LANGFUSE_REDIS_AUTH=langfuse
```

### Example 8: `docker-compose.yml` — service skeleton (full stack)

```yaml
# docker-compose.yml (skeleton; planner fills in concrete env blocks)
version: "3.9"

networks:
  brain-net:
    driver: bridge

volumes:
  brain-pg-data:
  rmq-data:
  qdrant-data:
  lf-pg-data:
  ch-data:
  redis-data:
  minio-data:

services:
  # ─── Core path ───────────────────────────────────────────────
  brain-postgres:
    image: postgres:17-trixie
    environment:
      POSTGRES_USER: brain
      POSTGRES_PASSWORD: brain
      POSTGRES_DB: brain
    volumes: ["brain-pg-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U brain -d brain"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    networks: [brain-net]

  rabbitmq:
    image: rabbitmq:4.1-management-alpine
    ports: ["127.0.0.1:15672:15672"]
    volumes: ["rmq-data:/var/lib/rabbitmq"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 10s
      retries: 6
      start_period: 30s
    networks: [brain-net]

  qdrant:
    image: qdrant/qdrant:v1.18.0
    ports: ["127.0.0.1:6333:6333"]
    volumes: ["qdrant-data:/qdrant/storage"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- localhost:6333/healthz || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
    networks: [brain-net]

  brain-migrate:
    build:
      context: .
      dockerfile: docker/Dockerfile
      target: prod
    env_file: .env
    command: ["python", "-m", "brain.db.migrate"]
    depends_on:
      brain-postgres: { condition: service_healthy }
    networks: [brain-net]
    restart: "no"

  brain:
    build:
      context: .
      dockerfile: docker/Dockerfile
      target: prod
    env_file: .env
    ports: ["8000:8000"]
    depends_on:
      brain-migrate: { condition: service_completed_successfully }
      brain-postgres: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
      qdrant: { condition: service_healthy }
    networks: [brain-net]
    # NOTE: Langfuse intentionally NOT in depends_on (PITFALL 8.1, D-11)

  # ─── Langfuse subsystem (5 services) ──────────────────────────
  langfuse-postgres:
    image: postgres:17-trixie
    environment:
      POSTGRES_USER: langfuse
      POSTGRES_PASSWORD: ${LANGFUSE_POSTGRES_PASSWORD}
      POSTGRES_DB: langfuse
    volumes: ["lf-pg-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U langfuse"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [brain-net]

  clickhouse:
    image: clickhouse/clickhouse-server:24.8-alpine  # ClickHouse 24.x stable, >= 24.3 (Langfuse req)
    environment:
      CLICKHOUSE_DB: default
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: ${LANGFUSE_CLICKHOUSE_PASSWORD}
    volumes: ["ch-data:/var/lib/clickhouse"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- localhost:8123/ping || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 60s   # ClickHouse first boot can take >60s
    networks: [brain-net]

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--requirepass", "${LANGFUSE_REDIS_AUTH}"]
    volumes: ["redis-data:/data"]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a ${LANGFUSE_REDIS_AUTH} ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [brain-net]

  minio:
    # PINNED to last community release — MinIO project archived in 2026
    # See ## Open Questions for migration plan (Garage / SeaweedFS / RustFS)
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z-cpuv1
    command: ["server", "--address", ":9000", "--console-address", ":9001", "/data"]
    environment:
      MINIO_ROOT_USER: ${LANGFUSE_MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${LANGFUSE_MINIO_ROOT_PASSWORD}
    volumes: ["minio-data:/data"]
    healthcheck:
      test: ["CMD-SHELL", "mc ready local || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [brain-net]

  langfuse-web:
    image: langfuse/langfuse:3.175.0
    ports: ["3000:3000"]
    environment:
      NEXTAUTH_SECRET: ${LANGFUSE_NEXTAUTH_SECRET}
      SALT: ${LANGFUSE_SALT}
      ENCRYPTION_KEY: ${LANGFUSE_ENCRYPTION_KEY}
      DATABASE_URL: postgresql://langfuse:${LANGFUSE_POSTGRES_PASSWORD}@langfuse-postgres:5432/langfuse
      CLICKHOUSE_URL: http://clickhouse:8123
      CLICKHOUSE_MIGRATION_URL: clickhouse://clickhouse:9000
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: ${LANGFUSE_CLICKHOUSE_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_AUTH: ${LANGFUSE_REDIS_AUTH}
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: langfuse
      LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: http://minio:9000
      LANGFUSE_S3_EVENT_UPLOAD_REGION: auto
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_MINIO_ROOT_USER}
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_MINIO_ROOT_PASSWORD}
      LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: "true"
      LANGFUSE_S3_MEDIA_UPLOAD_BUCKET: langfuse
      LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT: http://minio:9000
      LANGFUSE_S3_MEDIA_UPLOAD_REGION: auto
      LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_MINIO_ROOT_USER}
      LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_MINIO_ROOT_PASSWORD}
      LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE: "true"
      NEXTAUTH_URL: http://localhost:3000
      TELEMETRY_ENABLED: "false"
    depends_on:
      langfuse-postgres: { condition: service_healthy }
      clickhouse: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    # Upstream image ships NO baked healthcheck — add our own
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/public/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s
    networks: [brain-net]

  langfuse-worker:
    image: langfuse/langfuse-worker:3.175.0
    environment:
      # Same shared block as langfuse-web (DATABASE_URL, CLICKHOUSE_*, REDIS_*, S3_*, SALT, ENCRYPTION_KEY)
      DATABASE_URL: postgresql://langfuse:${LANGFUSE_POSTGRES_PASSWORD}@langfuse-postgres:5432/langfuse
      CLICKHOUSE_URL: http://clickhouse:8123
      CLICKHOUSE_MIGRATION_URL: clickhouse://clickhouse:9000
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: ${LANGFUSE_CLICKHOUSE_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_AUTH: ${LANGFUSE_REDIS_AUTH}
      SALT: ${LANGFUSE_SALT}
      ENCRYPTION_KEY: ${LANGFUSE_ENCRYPTION_KEY}
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: langfuse
      LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: http://minio:9000
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_MINIO_ROOT_USER}
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_MINIO_ROOT_PASSWORD}
      LANGFUSE_S3_EVENT_UPLOAD_REGION: auto
      LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: "true"
      LANGFUSE_S3_MEDIA_UPLOAD_BUCKET: langfuse
      LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT: http://minio:9000
      LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_MINIO_ROOT_USER}
      LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_MINIO_ROOT_PASSWORD}
      LANGFUSE_S3_MEDIA_UPLOAD_REGION: auto
      LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE: "true"
      TELEMETRY_ENABLED: "false"
    depends_on:
      langfuse-postgres: { condition: service_healthy }
      clickhouse: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    networks: [brain-net]
```

`[CITED: github.com/langfuse/langfuse — docker-compose.yml — env var shape; healthcheck patterns]`
`[CITED: langfuse.com/self-hosting/configuration — required env vars: NEXTAUTH_SECRET, SALT, ENCRYPTION_KEY, DATABASE_URL, CLICKHOUSE_*, REDIS_*, S3_*]`

**Notes:**
- Upstream `langfuse/langfuse:3` and `langfuse/langfuse-worker:3` do NOT ship baked Docker healthchecks `[VERIFIED: github.com/langfuse/langfuse/blob/main/docker-compose.yml — healthcheck section is empty for both]`. Brain's compose adds them explicitly using `/api/public/health` for the web service.
- `LANGFUSE_INIT_*` env vars (project bootstrap) are optional and only useful for one-shot dev setups; the planner may choose to include them or document `curl http://localhost:3000` first-time signup.
- `start_period: 60s` for ClickHouse and Langfuse-web matches observed first-boot times.

### Example 9: `docker-compose.lite.yml` — inner-loop subset

```yaml
# docker-compose.lite.yml — 5 services only, no Langfuse subsystem
version: "3.9"

networks:
  brain-net:
    driver: bridge

volumes:
  brain-pg-data-lite:
  rmq-data-lite:
  qdrant-data-lite:

services:
  brain-postgres:
    image: postgres:17-trixie
    environment:
      POSTGRES_USER: brain
      POSTGRES_PASSWORD: brain
      POSTGRES_DB: brain
    volumes: ["brain-pg-data-lite:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U brain -d brain"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [brain-net]

  rabbitmq:
    image: rabbitmq:4.1-management-alpine
    ports: ["127.0.0.1:15672:15672"]
    volumes: ["rmq-data-lite:/var/lib/rabbitmq"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      retries: 6
      start_period: 30s
    networks: [brain-net]

  qdrant:
    image: qdrant/qdrant:v1.18.0
    ports: ["127.0.0.1:6333:6333"]
    volumes: ["qdrant-data-lite:/qdrant/storage"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- localhost:6333/healthz || exit 1"]
      interval: 5s
      retries: 10
    networks: [brain-net]

  brain-migrate:
    build: { context: ., dockerfile: docker/Dockerfile, target: prod }
    env_file: .env
    command: ["python", "-m", "brain.db.migrate"]
    depends_on:
      brain-postgres: { condition: service_healthy }
    networks: [brain-net]

  brain:
    build: { context: ., dockerfile: docker/Dockerfile, target: prod }
    env_file: .env
    ports: ["8000:8000"]
    environment:
      BRAIN_LANGFUSE__ENABLED: "false"   # explicit guarantee no langfuse calls
    depends_on:
      brain-migrate: { condition: service_completed_successfully }
      brain-postgres: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
      qdrant: { condition: service_healthy }
    networks: [brain-net]
```

### Example 10: README spin-up section (DEPLOY-08)

```markdown
## Quickstart

```bash
git clone <repo> && cd brain
cp .env.example .env
# fill in OPENAI_API_KEY, GEMINI_API_KEY, BRAIN_AUTH__TOKEN
docker compose up -d                    # full stack
# OR
docker compose -f docker-compose.lite.yml up -d   # inner-loop (no Langfuse)

# Wait for healthy
docker compose ps

# Liveness
curl -s http://localhost:8000/healthz
# {"status":"ok"}

# Readiness (all deps green)
curl -s http://localhost:8000/readyz
# {"status":"ready","checks":{"postgres":"ok","rabbitmq":"ok","qdrant":"ok"}}
```
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact for Phase 1 |
|--------------|------------------|--------------|--------------------|
| `pip install -r requirements.txt` in Dockerfile | `uv sync --frozen --no-dev` with cache mount | uv 0.4 (2024); de-facto by 2026 | Mandatory per CLAUDE.md |
| `gunicorn -k uvicorn.workers.UvicornWorker` | `uvicorn --workers N` | uvicorn 0.20+ added native worker support; 0.47 is robust | Mandatory per CLAUDE.md |
| `asyncpg` for async Postgres in any LangGraph project | `psycopg[binary,pool]` v3 | LangGraph 1.x; checkpoint-postgres only supports psycopg v3 | Mandatory per CLAUDE.md + FOUND-06 |
| stdlib `logging` with `JSONFormatter` | `structlog 25.x` + `ProcessorFormatter` for stdlib bridging | structlog 24+ as canonical; nymous gist is the reference impl | Wire via `configure_logging()` |
| `from langfuse import Langfuse` v2 + `langfuse-python` v2 SDK | `langfuse 4.x` SDK + Langfuse v3 server (5 services) | Langfuse v3 GA 2025 | Pin both; never mix 4.x SDK with v2 server |
| `python:3.11-alpine` | `python:3.12-slim-bookworm` | ML wheels lag on 3.13; alpine breaks `psycopg[binary]` | Mandatory per CLAUDE.md |
| Single-container Langfuse | 5-service subsystem (web + worker + postgres + clickhouse + redis + S3) | Langfuse v3 GA | Compose footprint grows; lite override exists for inner-loop |
| `pika` (sync) | `aio-pika` 9.6 (async `connect_robust`) | 2024; sync pika is anti-pattern in async apps | Mandatory per CLAUDE.md |
| Compose v2 `version: "3.x"` field | Optional (ignored) but harmless to keep | 2024 | Examples keep `version:` for clarity |
| MinIO official images | Last community release (2025-09-07); migrate to Garage/SeaweedFS in v1.x | MinIO archived early 2026 | Phase 1 pins pre-archive release; tracking issue created |

**Deprecated / outdated:**
- `text-embedding-004` (Gemini) — shut down January 2026 → use `gemini-embedding-001` (Phase 7)
- `langchain` meta-package — bloats deps; install `langchain-core` + provider packages only
- `:latest` tags in compose — non-reproducible; banned

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AsyncPostgresSaver.setup()` does NOT automatically create tables in the `langgraph.*` schema — it writes to whatever `search_path` resolves to (default `public`). Workaround: set `search_path=langgraph` in the DSN or before calling `.setup()`. | Pitfall 2 | FOUND-07 fails silently — Brain compose looks healthy but `brain-postgres` has checkpoint tables in `public`. Planner must verify against `langgraph-checkpoint-postgres` 3.1.0 source / release notes; if `.setup()` accepts a `schema` parameter in 3.1.0, Pitfall 2 collapses to a one-line config change. |
| A2 | Upstream `langfuse/langfuse:3.175.0` and `langfuse/langfuse-worker:3.175.0` images do NOT ship baked Docker healthchecks. Brain's compose adds them via `/api/public/health` for the web service and omits a worker healthcheck (relying on `depends_on: redis/clickhouse: service_healthy`). | Example 8 | Misleading "healthy" status from Compose. If Langfuse later bakes in a healthcheck, Brain's `healthcheck:` block becomes a redundant override (harmless) — easy to detect on a compose-config diff. |
| A3 | The chosen MinIO pinned tag `RELEASE.2025-09-07T16-13-09Z-cpuv1` is the last community release publicly available on Docker Hub. Planner should verify it pulls cleanly at planning time and pick the latest stable RELEASE.2025-* tag if a slightly newer one is still mirrored. | Pitfall 8 | If Docker Hub eventually removes the tag, the compose breaks. Mitigation: mirror the image to a project-controlled registry in Phase 9. |
| A4 | Brain's `--workers 1` is correct for v1 even on a multi-core dev box. Persona cache + lock registry are in-process; multi-worker uvicorn would break the lock semantics. Horizontal scale = more containers, not more workers. | Code Example 4 / Dockerfile | Surfaces only at scale; Phase 1 has no real traffic, so this assumption is safe through Phase 8. Phase 9 / v2-HARD-06 (distributed lock) revisits. |
| A5 | `ClickHouse 24.8-alpine` satisfies Langfuse's "`>= 24.3`" requirement and is current-stable as of the research date. Planner should `docker pull` and confirm. | Example 8 | If 24.8 is yanked, fall back to `24.3-alpine` (the minimum supported). |
| A6 | `uv 0.11.16` is the locked version in CLAUDE.md, but the Dockerfile uses `ghcr.io/astral-sh/uv:0.11.16` (image tag matches the CLI version). Verify the image tag exists. | Code Example 4 / Dockerfile | If the tag doesn't exist, the build fails. Replace with `ghcr.io/astral-sh/uv:0.11` (minor tag) as the safer fallback. |
| A7 | `BRAIN_LANGFUSE__ENABLED=false` in `docker-compose.lite.yml` is sufficient to ensure Brain never makes outbound Langfuse calls in lite mode (no DNS lookup, no SDK init). | Example 9 | Phase 1 ships the env flag; Phase 4 wires the Langfuse SDK behind this flag. If Phase 4 forgets, lite mode might attempt connections to non-existent `langfuse-web:3000`. Code review item. |
| A8 | Pre-commit's `ban-raw-thread-id` shell hook in Example 1 catches f-string patterns reliably. Regex coverage may have false negatives (e.g., string concatenation `bot_id + ":" + session_id`). Acceptable trade-off — full AST analysis is overkill for Phase 1. | Example 1 | A determined dev can sidestep the lint; code review is the second layer. |

**The Assumptions Log surfaces 8 claims that need user/maintainer confirmation. None block Phase 1 planning — they all gate verification at execution time.**

---

## Open Questions

1. **`AsyncPostgresSaver.setup()` and schema namespacing.**
   - What we know: `.from_conn_string()` enforces `autocommit=True, prepare_threshold=0, row_factory=dict_row`. `.setup()` is idempotent.
   - What's unclear: Whether 3.1.0 honors a non-`public` `search_path` on the connection, or whether it hardcodes `public.checkpoints`.
   - Recommendation: Plan step 1 of `brain-migrate` runs Alembic (creates `brain.*` + schema), step 2 runs `CREATE SCHEMA IF NOT EXISTS langgraph; SET search_path TO langgraph` immediately before `.setup()`, then asserts table presence via `SELECT to_regclass('langgraph.checkpoints')`. Fail the init container if assertion fails.

2. **MinIO replacement timeline.**
   - What we know: Upstream MinIO community is archived. Phase 1 pins a pre-archive release.
   - What's unclear: Which S3-compatible alternative (Garage, SeaweedFS, RustFS) integrates cleanly with Langfuse v3 — none have been validated against Langfuse's `LANGFUSE_S3_*` env shape in production-grade testing the research could surface.
   - Recommendation: Track as a v1.x backlog item; reassess at Phase 9. Not a Phase-1 blocker.

3. **Should `brain-migrate` also assert `brain.*` schema presence?**
   - What we know: Alembic's `version_table_schema="brain"` + `include_name` ensures Alembic only manages `brain.*`. Migrations are idempotent on re-run.
   - What's unclear: Whether the planner wants `brain-migrate` to additionally `SELECT to_regclass('brain.alembic_version')` post-run as a smoke check.
   - Recommendation: YES — a one-line assertion at the end of `brain.db.migrate` makes the init-container exit code reflect reality, not just absence of exception.

4. **CI smoke test scope.**
   - What we know: Phase 1 success criterion #1 wants `docker compose up` deterministic.
   - What's unclear: Should CI actually `docker compose up` the full 10-service stack, or only the lite stack? Full stack is ~3GB image pull + 90s+ startup.
   - Recommendation: CI runs lite stack on every PR; full stack on a nightly job. Phase 1 plan must encode this split.

---

## Environment Availability

This audit assumes Phase 1 will be developed on a Linux host with Docker + Docker Compose + Python 3.12 available locally. The compose stack supplies Postgres, RabbitMQ, Qdrant, Langfuse — no host-side install of those services needed.

| Dependency | Required By | Available (assumed dev box) | Version target | Fallback |
|------------|-------------|-----------------------------|----------------|----------|
| Docker | Compose stack | assumed ✓ | ≥ 24.x | None — hard block |
| Docker Compose (v2 plugin) | Compose stack | assumed ✓ | ≥ 2.20 | None — hard block |
| Python 3.12 | Dev shell / `uv sync` outside Docker | assumed ✓ | 3.12.x | Use Docker dev image |
| `uv` CLI | Local dev workflows | optional ✓ | 0.11.16 | `pip install uv` |
| git | Source control | assumed ✓ | any modern | None |
| pre-commit | Hook framework | optional | ≥ 3.x | `uvx pre-commit` ad-hoc |
| gitleaks binary | Pre-commit hook | installed by pre-commit | 8.x | CI is the safety net |
| ~8 GiB free RAM | Full compose footprint | assumed ✓ | — | Use lite compose |
| ~10 GiB free disk | Image pulls + volumes | assumed ✓ | — | None |

**Missing dependencies with no fallback:**
- None known at planning time. The compose model is the abstraction layer.

**Missing dependencies with fallback:**
- Host Python 3.12 — fallback to Docker dev image (the Dockerfile's `dev` stage).

---

## Validation Architecture

Phase 1 produces infra + scaffolding, not business logic. Validation is dominated by smoke tests + lint gates + env-validation tests.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 + pytest-asyncio 1.3.0 |
| Config file | `pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command | `uv run pytest -x -q` |
| Full suite command | `uv run pytest --cov=brain --cov-fail-under=80 -q` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Python 3.12 + uv-pinned deps | smoke | `python --version \| grep 3.12 && uv lock --check` | ❌ Wave 0 (lockfile created in Phase 1) |
| FOUND-02 | LangGraph triple exact-pinned | smoke | `grep -E '^langgraph(-checkpoint(-postgres)?)?\s*=\s*"==' pyproject.toml \| wc -l \| grep 3` | ❌ Wave 0 |
| FOUND-03 | `/healthz` 200, `/readyz` 200/503 shape | unit | `uv run pytest tests/test_health.py -x` | ❌ Wave 0 |
| FOUND-04 | All config from `.env` | unit | `uv run pytest tests/test_settings.py::test_no_hardcoded_endpoints -x` | ❌ Wave 0 |
| FOUND-05 | Pydantic Settings fails fast on missing env | unit | `uv run pytest tests/test_settings.py::test_missing_required_env_raises -x` | ❌ Wave 0 |
| FOUND-06 | psycopg v3 used, asyncpg banned | lint | `uv run ruff check src/` + grep ban | ❌ Wave 0 |
| FOUND-07 | Two schemas after migrate | integration | `uv run pytest tests/integration/test_migrate.py -x` (uses testcontainers) | ❌ Wave 0 |
| FOUND-08 | `thread_id(bot_id, session_id)` helper + ban | unit + lint | `uv run pytest tests/test_thread_id.py -x` + pre-commit hook | ❌ Wave 0 |
| FOUND-09 | Graceful shutdown drains | integration | `uv run pytest tests/integration/test_shutdown.py -x` (signal-based) | ❌ Wave 0 |
| FOUND-10 | JSON logs, no print/stdlib logging | lint | `uv run ruff check --select T201,G004 src/` | ❌ Wave 0 |
| FOUND-11 | schema_version rejection | unit | `uv run pytest tests/test_schema_version.py -x` | ❌ Wave 0 |
| FOUND-12 | gitleaks + .env gitignored | smoke + CI | `git check-ignore .env && gitleaks detect --no-git --source .env.example --config .gitleaks.toml` | ❌ Wave 0 |
| AUTH-03 | Provider keys never logged | manual-only* | `grep -rE 'OPENAI_API_KEY\|GEMINI_API_KEY' src/ \| grep -v config/settings.py` | ❌ Wave 0 (full canary test in Phase 4) |
| AUTH-04 | 32KB payload cap | unit | `uv run pytest tests/test_payload_cap.py -x` (Phase 1 ships the constant + helper; full test in Phase 3) | ❌ Wave 0 |
| DEPLOY-01 | Full stack healthy | smoke (nightly CI) | `bash scripts/smoke-up.sh full` | ❌ Wave 0 |
| DEPLOY-02 | Lite stack healthy | smoke (per-PR CI) | `bash scripts/smoke-up.sh lite` | ❌ Wave 0 |
| DEPLOY-03 | Multi-stage Dockerfile builds | smoke | `docker build --target prod -t brain:test .` | ❌ Wave 0 |
| DEPLOY-04 | Healthchecks declared everywhere | smoke | `docker compose config \| yq '.services.[] \| select(.healthcheck == null)'` returns empty | ❌ Wave 0 |
| DEPLOY-05 | brain-migrate runs Alembic + setup | integration | `bash scripts/smoke-up.sh lite && docker compose exec brain-postgres psql -U brain -c '\dn' \| grep -E 'brain\|langgraph'` | ❌ Wave 0 |
| DEPLOY-06 | brain-topology-init slot exists | smoke | `grep -A1 brain-topology-init docker-compose.yml \| grep -q image\|build` (Phase 1: comment placeholder; Phase 8 wires) | ❌ Wave 0 |
| DEPLOY-07 | `.env.example` documents every var, `.env` gitignored | smoke | `bash scripts/check-env-example.sh` + `git check-ignore .env` | ❌ Wave 0 |
| DEPLOY-08 | README copy-paste works | manual | `bash scripts/smoke-readme.sh` | ❌ Wave 0 |

*AUTH-03 full canary regression lives in Phase 4 (Langfuse trace inspection) — Phase 1 only verifies that provider keys aren't `print`ed or `log.info`'d at startup.

### Sampling Rate

- **Per task commit:** `uv run pytest -x -q` (unit tests, ~5s)
- **Per wave merge:** `uv run pytest --cov=brain --cov-fail-under=80` + `uv run ruff check .` + `gitleaks protect --staged`
- **Phase gate:** Full suite green + `bash scripts/smoke-up.sh lite` + `bash scripts/smoke-up.sh full` (nightly CI) before `/gsd-verify-work`

### Wave 0 Gaps

All test infrastructure must be created in Phase 1's Wave 0 because the repo is greenfield:

- [ ] `pyproject.toml` `[tool.pytest.ini_options]` block (asyncio mode = auto)
- [ ] `tests/conftest.py` — shared fixtures: `settings_factory`, `monkeypatched_env`, `psycopg_pool` (testcontainers)
- [ ] `tests/test_settings.py` — Pydantic Settings happy path + missing env + bad type
- [ ] `tests/test_health.py` — `/healthz` 200; `/readyz` returns each dep status; cache window respected
- [ ] `tests/test_schema_version.py` — supported version passes; unsupported raises with `UNSUPPORTED_SCHEMA_VERSION` error
- [ ] `tests/test_thread_id.py` — happy path + empty arg + separator-in-arg
- [ ] `tests/test_payload_cap.py` — body > 32KB raises before parsing
- [ ] `tests/integration/test_migrate.py` — testcontainers postgres → run migrate → assert both schemas present
- [ ] `tests/integration/test_shutdown.py` — start app, send SIGTERM mid-request, assert request completes
- [ ] `scripts/smoke-up.sh` — `up -d`, poll `docker compose ps` for `(healthy)` on every service with timeout, `curl /healthz` + `/readyz`, then `down`
- [ ] `scripts/check-env-example.sh` — diff `.env.example` keys against `Settings` fields
- [ ] `scripts/check-compose-parity.sh` — diff core-service blocks between `docker-compose.yml` and `docker-compose.lite.yml`
- [ ] `.github/workflows/ci.yml` — ruff + mypy + pytest + gitleaks + lite smoke

Framework install (one command sets up Wave 0 dependencies):

```bash
uv add --dev pytest==9.0.3 pytest-asyncio==1.3.0 pytest-cov \
             'testcontainers[postgres,rabbitmq]' ruff==0.15.14 mypy
```

---

## Security Domain

Phase 1's security surface is configuration, not request handling. Bearer-token enforcement (AUTH-01/02) lives in Phase 3; provider-key masking in Langfuse traces (AUTH-03 trace half + OBS-06) lives in Phase 4. Phase 1 sets the guardrails so later phases can't accidentally undo them.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | `src/brain/` 11-package layout enforces separation of concerns |
| V2 Authentication | partial (Phase 1 declares `BRAIN_AUTH__TOKEN`; Phase 3 enforces) | Static Bearer token via env; Pydantic Settings refuses startup without it |
| V3 Session Management | no (Phase 6) | n/a — `thread_id` helper lays foundation |
| V4 Access Control | no (Phase 2/3) | n/a in Phase 1 |
| V5 Input Validation | partial | Pydantic Settings for env; `schema_version` validator helper shipped (used by Phase 3 BrainRequest) |
| V6 Cryptography | yes (Langfuse `ENCRYPTION_KEY` + `SALT` + `NEXTAUTH_SECRET` must be high-entropy, env-sourced, never hardcoded) | `.env.example` placeholders; gitleaks catches accidents |
| V7 Error Handling & Logging | yes | structlog JSON; `Authorization`-header strip middleware groundwork (Phase 3 finalizes) |
| V8 Data Protection | yes | `.env` gitignored; gitleaks pre-commit + CI (FOUND-12, D-18) |
| V9 Communication | partial | All inter-service traffic on `brain-net` Docker bridge (no public exposure of internal services per D-12) |
| V10 Malicious Code | no (out of scope) | n/a |
| V14 Configuration | yes | `pyproject.toml` pins; `extra="forbid"` Settings; `:latest` banned; multi-stage non-root Dockerfile |

### Known Threat Patterns for {Python + FastAPI + LangGraph + Docker Compose}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Provider API keys in git history | Information Disclosure | gitleaks pre-commit + CI; `.env` in `.gitignore`; `<REPLACE_ME>` placeholders in `.env.example` (PITFALL 5.3) |
| Secrets leaked to logs / traces | Information Disclosure | structlog JSON with explicit field list (D-14); ban `print` + stdlib logging f-strings (T201, G004); future Langfuse mask in Phase 4 (PITFALL 5.1) |
| Service started before deps ready → race conditions | Denial of Service | `depends_on: condition: service_healthy` everywhere (D-11, DEPLOY-04, PITFALL 6.1) |
| Privilege escalation via root container | Elevation of Privilege | Non-root `brain` user (uid 1001) in prod Dockerfile (DEPLOY-03) |
| Stale dependency CVEs | Tampering | `uv lock` exact pins surface CVE reports cleanly; Phase 9 ships a Dependabot policy |
| `:latest` image tag drift | Tampering | All compose images pinned explicitly (CLAUDE.md §10 / DEPLOY-01..02) |
| Postgres credentials exposed | Information Disclosure | Internal-only on `brain-net` (D-12); not published to host except for `:15672/:6333/:3000/:8000` |
| RabbitMQ default `guest:guest` reachable across containers | Spoofing / Elevation | Custom `brain:brain` creds in `.env.example` (PITFALL 5.4); management UI on `:15672` host-bound but not exposed publicly |
| Langfuse outage → Brain blocked | Denial of Service | Langfuse OUT of Brain's `depends_on` (D-11, PITFALL 8.1); fire-and-forget callbacks land in Phase 4 |
| MinIO archived / unmaintained → CVE accumulation | Tampering | Pin pre-archive RELEASE; track migration to maintained S3-compatible store as a v1.x backlog item (Open Question 2) |

---

## Sources

### Primary (HIGH confidence)

- `/root/Brain/CLAUDE.md` — locked tech stack, conventional-commit policy, anti-recommendations. **Authoritative for this project.**
- `/root/Brain/.planning/research/STACK.md` §1–11 — full version pins, compatibility matrix
- `/root/Brain/.planning/research/ARCHITECTURE.md` §"System Overview", §"Component Boundaries", §"Configuration Schema"
- `/root/Brain/.planning/research/PITFALLS.md` §1.1, §1.2, §5.1, §5.3, §5.4, §6.1, §6.2, §7.1, §7.2, §8.1, §10.1
- `/root/Brain/.planning/research/SUMMARY.md` §"Phase 1"
- `/root/Brain/.planning/research/FEATURES.md` TS-2, TS-3, TS-15, TS-18, TS-20
- [https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver](https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver) — `from_conn_string`, `.setup()` semantics
- [https://pypi.org/project/langgraph-checkpoint-postgres/](https://pypi.org/project/langgraph-checkpoint-postgres/) — psycopg v3 requirement, autocommit + row_factory + prepare_threshold caveats
- [https://docs.astral.sh/uv/guides/integration/docker/](https://docs.astral.sh/uv/guides/integration/docker/) — canonical multi-stage uv Dockerfile pattern
- [https://docs.pydantic.dev/latest/concepts/pydantic_settings/](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) — nested sub-models, `env_nested_delimiter`, `SettingsConfigDict`
- [https://www.uvicorn.org/server-behavior/](https://www.uvicorn.org/server-behavior/) — SIGTERM + `--timeout-graceful-shutdown` semantics
- [https://fastapi.tiangolo.com/advanced/events/](https://fastapi.tiangolo.com/advanced/events/) — lifespan async context manager
- [https://docs.astral.sh/ruff/rules/print/](https://docs.astral.sh/ruff/rules/print/) — T201
- [https://docs.astral.sh/ruff/rules/logging-f-string/](https://docs.astral.sh/ruff/rules/logging-f-string/) — G004
- [https://github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) — 8.x CLI, config schema, pre-commit + GitHub Action shapes
- [https://langfuse.com/self-hosting/configuration](https://langfuse.com/self-hosting/configuration) — required env vars (NEXTAUTH_SECRET, SALT, ENCRYPTION_KEY, DATABASE_URL, CLICKHOUSE_*, REDIS_*, S3_*)
- [https://langfuse.com/self-hosting/deployment/docker-compose](https://langfuse.com/self-hosting/deployment/docker-compose) — 5-service subsystem topology, ClickHouse first-boot duration
- [https://github.com/langfuse/langfuse/blob/main/docker-compose.yml](https://github.com/langfuse/langfuse/blob/main/docker-compose.yml) — env var enumeration; healthchecks absent on web/worker images
- [https://www.structlog.org/en/stable/contextvars.html](https://www.structlog.org/en/stable/contextvars.html) — `merge_contextvars`, `bind_contextvars`, `clear_contextvars`
- [https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e](https://gist.github.com/nymous/f138c7f06062b7c43c060bf03759c29e) — canonical structlog + FastAPI + uvicorn integration (ProcessorFormatter)
- [https://python-client.qdrant.tech/qdrant_client.async_qdrant_client](https://python-client.qdrant.tech/qdrant_client.async_qdrant_client) — `AsyncQdrantClient.healthz()` API
- [https://api.qdrant.tech/api-reference/service/healthz](https://api.qdrant.tech/api-reference/service/healthz) — Kubernetes-style `/healthz` endpoint
- [https://docs.docker.com/compose/how-tos/startup-order/](https://docs.docker.com/compose/how-tos/startup-order/) — `service_healthy` + `service_completed_successfully` conditions
- [https://github.com/langchain-ai/docs/issues/465](https://github.com/langchain-ai/docs/issues/465) — Postgres schema namespacing for LangGraph (PITFALL 6.1 origin)

### Secondary (MEDIUM confidence)

- [https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-compose-init-containers-pattern/view](https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-compose-init-containers-pattern/view) — init container pattern in Compose
- [https://depot.dev/docs/container-builds/how-to-guides/optimal-dockerfiles/python-uv-dockerfile](https://depot.dev/docs/container-builds/how-to-guides/optimal-dockerfiles/python-uv-dockerfile) — production uv Dockerfile patterns
- [https://www.d4b.dev/blog/2026-02-01-gitleaks-pre-commit-hook/](https://www.d4b.dev/blog/2026-02-01-gitleaks-pre-commit-hook/) — gitleaks pre-commit setup
- [https://gist.github.com/h4/fc9b6d350544ff66491308b535762fee](https://gist.github.com/h4/fc9b6d350544ff66491308b535762fee) — Alembic multi-schema env.py pattern
- [https://hub.docker.com/r/minio/minio/tags](https://hub.docker.com/r/minio/minio/tags) — last community MinIO release tags
- [https://hub.docker.com/r/clickhouse/clickhouse-server/](https://hub.docker.com/r/clickhouse/clickhouse-server/) — `24.8-alpine` and `24.3-alpine` tag availability

### Tertiary (LOW confidence — needs verification at planning time)

- [https://jangwook.net/en/blog/en/langfuse-self-hosted-llm-tracing-setup-guide-2026/](https://jangwook.net/en/blog/en/langfuse-self-hosted-llm-tracing-setup-guide-2026/) — third-party Langfuse v3 deployment notes
- [https://productimpossible.com/articles/self-hosted-s3-after-minio/](https://productimpossible.com/articles/self-hosted-s3-after-minio/) — MinIO alternatives landscape (Garage / SeaweedFS / RustFS)

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — pinned versions mirror CLAUDE.md, verified against PyPI on 2026-05-21 per STACK.md §12
- Architecture / Patterns: HIGH — every pattern grounded in CONTEXT.md decisions or cited upstream docs
- Code Examples: HIGH for FastAPI / Pydantic / structlog patterns; MEDIUM for AsyncPostgresSaver schema namespacing (see Assumption A1)
- Pitfalls: HIGH — drawn from PITFALLS.md and the focus-item research
- Langfuse compose: MEDIUM — version pins are recent and the env var list is sourced from upstream docs, but Langfuse v3 has had several minor-version churns in the env shape over 2025-2026; planner should regenerate against `langfuse/langfuse:3.175.0` source at planning time
- MinIO supply chain: MEDIUM-LOW — image is still pullable but upstream is archived; long-term replacement is a v1.x decision

**Research date:** 2026-05-22
**Valid until:** 2026-06-20 (30 days; faster expiry for Langfuse env var changes and MinIO tag drift)
