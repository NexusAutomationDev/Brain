# Stack Research

**Project:** Brain — centralized LangGraph-based multi-bot AI orchestration service
**Domain:** Python LLM orchestration backend (LangGraph + multi-provider LLMs + vector memory + queue/webhook ingress)
**Researched:** 2026-05-21
**Overall confidence:** HIGH

All versions verified live against PyPI / Docker Hub / GitHub releases on 2026-05-21. No version recalled from training data.

---

## Executive Recommendation

```
Runtime:     Python 3.12 (slim) on Docker Compose
Framework:   FastAPI 0.136 + Uvicorn 0.47
Graph:       langgraph 1.2.1 + langgraph-checkpoint-postgres 3.1.0
LLMs:        langchain-openai 1.2.2  +  langchain-google-genai 4.2.3
DB:          Postgres 17 (alpine/trixie) via psycopg[binary,pool] 3.3.4   <-- NOT asyncpg
Queue:       RabbitMQ 4.1-management-alpine via aio-pika 9.6.2
Vector DB:   Qdrant v1.18.0  <-- recommended (see comparison below)
Embeddings:  OpenAI text-embedding-3-small (default), configurable per-provider
Tracing:     Langfuse v3.175 (server) + langfuse 4.6.1 (Python SDK)
Validation:  pydantic 2.13 + pydantic-settings 2.14
Tooling:     uv 0.11 + ruff 0.15 + pytest 9.0 + pytest-asyncio 1.3
```

---

## 1. Web Framework — FastAPI 0.136.1

**HIGH confidence.** FastAPI is the unambiguous 2025-2026 standard for Python async HTTP APIs in the LLM / LangChain ecosystem, and it composes natively with the rest of the stack:

| Reason | Detail |
|---|---|
| Async-native | Bearer-token webhook needs to call into async LangGraph + async aio-pika + async vector clients without thread-pool bridging. |
| Pydantic v2 first-class | Same models that validate the `{botId, sessionId, conteudo}` HTTP payload are reused for the RabbitMQ message schema and the bot-persona CRUD entities. |
| OpenAPI for free | The bot-CRUD admin API gets `/docs` and `/openapi.json` with zero extra code, which other bot teams can use to generate clients. |
| Dependency injection | `Depends(verify_bearer)` is the canonical, testable shape for the static-token auth requirement. |

**Companion packages (pin together):**

| Package | Version | Why |
|---|---|---|
| `fastapi` | `0.136.1` | Web framework |
| `uvicorn[standard]` | `0.47.0` | ASGI server (use `--workers N` behind compose; not gunicorn) |
| `pydantic` | `2.13.4` | Schema validation (Pydantic v2 only — never v1) |
| `pydantic-settings` | `2.14.1` | `.env` → typed `Settings` class (required by the all-via-`.env` constraint) |
| `httpx` | `0.28.1` | Outbound HTTP (test client + any outbound webhook returns) |

**Alternatives considered:**

| Alternative | Verdict | Rationale |
|---|---|---|
| Litestar 2.x | Reject | Smaller ecosystem, no LangChain/Langfuse examples written against it. FastAPI is what every LangGraph tutorial and Langfuse cookbook targets. |
| Starlette (bare) | Reject | Forfeits pydantic body validation, dependency injection, and OpenAPI — all of which Brain needs. |
| Flask / Quart | Reject | Sync-rooted; mixing with async LangGraph is friction. |
| Django + DRF | Reject | Too heavy for a single-service backend with no HTML/ORM-coupled views. |

---

## 2. LangGraph Core — 1.2.1 (released 2026-05-21)

**HIGH confidence.** LangGraph just had its 1.x stabilization. Pin the 1.x minor and let patches float.

| Package | Version | Purpose |
|---|---|---|
| `langgraph` | `1.2.1` | Graph runtime, `StateGraph`, `Command`, persistence API |
| `langgraph-checkpoint` | `4.1.0` | Base checkpoint interface (transitive, but pin to avoid surprises) |
| `langgraph-checkpoint-postgres` | `3.1.0` | `PostgresSaver` + `AsyncPostgresSaver` (see §3) |
| `langchain-core` | `1.4.0` | Message types, runnables — required by every provider adapter |
| `langchain-openai` | `1.2.2` | `ChatOpenAI` (GPT-4.1) + `OpenAIEmbeddings` |
| `langchain-google-genai` | `4.2.3` | `ChatGoogleGenerativeAI` (Gemini 2.5 Flash) + Gemini embeddings |

**Notes:**

- Do **not** install `langchain` (the meta package). Install only the focused `langchain-core` + provider packages. The meta package pulls dozens of unwanted dependencies and is no longer the recommended shape since LangChain 0.3+.
- `langgraph` 1.x changed several import paths vs 0.2.x tutorials — always reference the official `langchain-ai/langgraph` repo, not blog posts.
- The provider-fallback requirement is satisfied by wrapping `ainvoke` calls in `tenacity` retry plus a custom orchestration node — don't rely on undocumented LangChain "fallback chains" for multi-provider failover; they exist but mask error types Brain wants to log to Langfuse.

**Supporting libraries:**

| Library | Version | When |
|---|---|---|
| `tenacity` | `9.1.4` | Retry policy for transient LLM/provider errors; fallback trigger |
| `tiktoken` | latest | Token counting for usage in response payload (OpenAI tokenizer) |

---

## 3. Postgres Checkpointer + Driver

**HIGH confidence.** The official path is **`langgraph-checkpoint-postgres` 3.1.0** using **`psycopg` (v3), NOT `asyncpg`**.

This is the single most common stack mistake Brain must avoid: many tutorials and the broader async-Python community default to `asyncpg`, but `langgraph-checkpoint-postgres` is built on `psycopg` v3 and expects psycopg connection objects. Mixing the two means hand-writing your own checkpointer.

| Component | Choice | Version | Why |
|---|---|---|---|
| Server | Postgres | `17-trixie` (Docker `postgres:17-trixie`) | Current stable major; `pgvector` extension compatible if Brain ever wants pgvector for any internal use. |
| Python driver | `psycopg[binary,pool]` | `3.3.4` | Required by `langgraph-checkpoint-postgres`. Async support is native (`psycopg.AsyncConnection`, `AsyncConnectionPool`). |
| Checkpointer | `langgraph-checkpoint-postgres` | `3.1.0` | Official, async-capable via `AsyncPostgresSaver.from_conn_string(...)`. |
| ORM (bot-persona CRUD) | `SQLAlchemy` | `2.0.49` | For the bot/persona/short-term-history tables that are NOT LangGraph checkpoint tables. v2 native async. |
| Migrations | `Alembic` | `1.18.4` | Standard SQLAlchemy migration tool. |

**Critical setup notes** (will save Brain a half-day of debugging in Phase 1):

1. On the very first run, Brain MUST call `await checkpointer.setup()` once to create the LangGraph tables. This is not automatic.
2. If passing a manually-constructed `psycopg.AsyncConnection`, set `autocommit=True` and `row_factory=dict_row` — otherwise checkpoint reads fail with cryptic errors.
3. `AsyncConnectionPool` + pipeline mode has a known interaction bug ([langgraph#3193](https://github.com/langchain-ai/langgraph/issues/3193)) — start without pipeline mode; enable only if throughput requires it.
4. Brain runs **one Postgres instance** serving two logical schemas: `langgraph` (checkpointer-managed) and `brain` (bots, personas, message-history, app tables). Use a single connection pool, separate schemas — this honors the "one DB to operate" constraint from PROJECT.md.

**Anti-recommendation:** Do NOT use `asyncpg` as Brain's primary driver. It is faster in microbenchmarks but incompatible with the official LangGraph checkpointer. If Brain ever needs raw `asyncpg` for one hot path, run it side-by-side with `psycopg` — do not try to replace.

---

## 4. Vector Database — **Qdrant v1.18.0**

**HIGH confidence in recommendation.** Comparison was performed against Brain's specific constraints (Docker Compose, multimodal headroom, per-bot isolation, Python SDK quality, free/self-hosted).

### Comparison Matrix

| Criterion | **Qdrant** | Weaviate | Milvus | pgvector | Chroma |
|---|---|---|---|---|---|
| **Docker Compose fit** | Single binary, single container, persistent volume. Excellent. | Single container but pulls a transformers sidecar by default; heavier compose footprint. | Multi-service (etcd + minio + milvus) — heaviest by far; effectively requires a sub-compose. | Already in the Postgres container; nothing to add. | Single container, simple. |
| **Multimodal roadmap** | **Native named vectors** — text, image, video, sparse can coexist on one point in one collection without schema gymnastics. | Modules system supports multimodal but requires picking image2vec modules at compose time; less flexible later. | Multimodal possible via separate collections; less ergonomic. | Multimodal = "another vector column"; works but feels bolted on. | Limited; text-first design, multimodal is community-add. |
| **Per-bot isolation** | Two clean options: (a) collection-per-bot, (b) single collection with `botId` payload filter + HNSW filterable index. **Both first-class.** | Tenants feature (multi-tenancy) is native and well-documented. | Possible via partitions/collections; ergonomics weaker. | `WHERE bot_id = ?` — trivial. | Collection-per-bot only realistic option; no real metadata filtering perf story. |
| **Python SDK quality** | `qdrant-client` 1.18 — typed, mature, sync + async, AsyncQdrantClient first-class. | `weaviate-client` 4.21 — v4 rewrite is good but younger; some sharp edges. | `pymilvus` 3.0 — capable but verbose API. | `pgvector` 0.4.2 — thin shim over psycopg; you write SQL. | `chromadb` 1.5 — easy but performance and ops story weakest. |
| **License / cost** | Apache 2.0, fully free self-hosted | BSD-3, free self-hosted; managed pushes hard. | Apache 2.0, free self-hosted. | PostgreSQL license — already paid for. | Apache 2.0, free. |
| **Operational complexity** | Lowest of the dedicated DBs. | Medium. | Highest (k8s strongly preferred in production). | Lowest overall — zero extra infra. | Low, but historically the most prone to data-loss / breaking changes between versions. |
| **Performance at Brain scale (≤10M vectors)** | Excellent; 10-25% faster than peers on common workloads, ~12ms p99 at 10M. | Excellent. | Excellent but overkill. | Good (sufficient under 10M). | Adequate. |
| **Filtered ANN (`botId` + `sessionId` filter)** | First-class — built filterable HNSW from day one; payload filters do not destroy recall. | Good. | Good. | Strong WHERE pushdown; works well. | Weakest. |
| **Hybrid search (dense+sparse)** | Native (BM25 sparse vectors + dense in one query). | Native. | Native. | Possible via tsvector + vector; manual. | No. |

### Recommendation: **Qdrant**

**Why Qdrant wins for Brain specifically:**

1. **Multimodal headroom is in PROJECT.md as an active requirement.** Qdrant's named vectors let Brain start with one `text-default` vector per point in v1 and later add `image`, `video`, or `clip` named vectors on the same point without re-modeling — this is precisely the deferred-multimodal shape Brain needs.
2. **Per-bot isolation has two valid patterns**, and Qdrant supports both well:
   - v1 default: **single collection `brain_memory`**, payload `{bot_id, session_id, ts, ...}`, with the HNSW index built filterable on `bot_id` + `session_id`. Cheapest operationally.
   - Escape hatch: collection-per-bot if any single bot turns out to need physical isolation (compliance, very large memory).
3. **Single-container Docker Compose** matches the "ship via `docker compose up`" constraint perfectly. No sidecars, no etcd, no MinIO.
4. **Async Python client** (`AsyncQdrantClient` from `qdrant-client` 1.18.0) composes natively with FastAPI + LangGraph nodes.
5. **License**: Apache 2.0, fully self-hostable, no managed-only features Brain would miss.

**Runners-up and when to prefer them:**

| Alternative | Use when |
|---|---|
| **pgvector** | If Brain decided to drop the dedicated vector DB entirely and accept that multimodal will be slow/bolted-on. Reduces compose by one service. Reconsider only if scale stays under ~500K vectors AND multimodal is deprioritized. |
| **Weaviate** | If multi-tenancy (one tenant = one bot) becomes a hard architectural requirement and Brain wants the platform to enforce it rather than payload filtering. |
| **Milvus** | Only at >100M vectors. Brain is nowhere near this. |

**Anti-recommendation:** **Chroma is rejected.** It has had repeated breaking changes between minor versions, weaker operational story, and no multimodal/multi-vector roadmap that matches Brain's needs. It's a great prototyping tool, not a service backbone.

| Package | Version | Purpose |
|---|---|---|
| `qdrant-client` | `1.18.0` | Async + sync Python client |
| Docker image | `qdrant/qdrant:v1.18.0` | Server (pin to a version tag, not `:latest`) |

---

## 5. Embedding Model — Default: **OpenAI `text-embedding-3-small`**

**HIGH confidence.**

**Default v1 choice:** `text-embedding-3-small` (1536 dims, $0.02/1M tokens, OpenAI).

**Rationale:**

- Highest accuracy/cost ratio of any commercial embedding model in 2026 benchmarks (nDCG@10 0.689 vs Gemini text-embedding-004 0.538).
- Brain already integrates OpenAI for chat — same API key, same SDK, same auth — zero additional ops surface.
- 1536 dimensions is the Qdrant sweet spot (good recall, modest memory).
- Supports dimension reduction (Matryoshka) if Brain later wants 512-d for memory savings.

**Configurability:**

The embedding choice must be **`.env`-driven and pluggable** so that:

- A Brain instance running with Gemini-only credentials can fall back to Gemini embeddings.
- A future air-gapped deployment can use BGE-M3 via Hugging Face TEI sidecar.

Recommended shape:

```python
class EmbeddingSettings(BaseSettings):
    embedding_provider: Literal["openai", "google", "bge_local"] = "openai"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
```

| Provider | Model | Dim | When |
|---|---|---|---|
| **OpenAI (default)** | `text-embedding-3-small` | 1536 | v1 default; best quality/cost |
| OpenAI (premium) | `text-embedding-3-large` | 3072 | If recall is insufficient; ~7× cost |
| Google | `gemini-embedding-001` | 768 / 3072 | If OpenAI is unavailable; the older `text-embedding-004` model is being shut down January 2026 — do NOT use it. Use `gemini-embedding-001` or later. |
| BGE / open-source | `BAAI/bge-m3` | 1024 | Air-gapped only; multilingual; runs via Hugging Face TEI sidecar |

**Anti-recommendation:** Do NOT use `text-embedding-ada-002` (legacy), do NOT use `text-embedding-004` (Gemini, being deprecated Jan 2026). Do NOT mix dimensions across a single Qdrant collection — embedding dimension changes require either a new collection or a new named-vector slot.

---

## 6. RabbitMQ Client — **aio-pika 9.6.2**

**HIGH confidence.**

**Choice: `aio-pika` 9.6.2** — the standard async AMQP 0.9.1 client.

| Reason | Detail |
|---|---|
| Async-native | Composes with FastAPI lifespan + LangGraph `ainvoke`. |
| Robust reconnect | `connect_robust()` recovers declared queues/exchanges/consumer state on broker restarts — Brain's compose stack will restart RabbitMQ during dev. |
| Publisher confirms | Available — needed so Brain can guarantee `brain.out` writes before acking `brain.in`. |
| Maintained | Active in 2026, Python 3.10+ supported. |

**Alternative considered: FastStream**

FastStream is a higher-level framework built **on top of aio-pika**. It adds: pydantic-validated messages, AsyncAPI spec generation, in-memory testing, declarative consumers.

> **Verdict:** Reasonable, but **start with raw `aio-pika`** for v1.
>
> - Brain's queue topology is small (one in, one out). Framework value is low at this size.
> - FastStream introduces an opinion (its app lifecycle) that competes with FastAPI's lifespan. Mixing them is doable but adds friction in v1.
> - You can adopt FastStream later without throwing away `aio-pika` knowledge, since it wraps it.

**Anti-recommendation:** Do NOT use `pika` (sync) directly. Brain is async-first; sync pika in a thread executor is a known anti-pattern that causes channel/thread issues at any non-trivial load.

| Package | Version |
|---|---|
| `aio-pika` | `9.6.2` |
| Docker image | `rabbitmq:4.1-management-alpine` (current stable 4.1.x, has the management UI on `:15672` for dev) |

---

## 7. Langfuse — Server v3.175.0, SDK `langfuse` 4.6.1

**HIGH confidence**, but with a **critical compose-footprint warning.**

| Component | Version | Notes |
|---|---|---|
| `langfuse` (Python SDK) | `4.6.1` | OpenTelemetry-based, native LangChain/LangGraph callback. |
| `langfuse/langfuse` (server) | `3.175.0` (Docker `langfuse/langfuse:3`) | Web + worker |

**Langfuse v3 is NOT a single container.** A self-hosted Langfuse v3 stack requires:

| Service | Purpose | Min resources |
|---|---|---|
| `langfuse-web` | UI + ingestion API | 2 CPU / 4 GiB |
| `langfuse-worker` | Async event processing | 2 CPU / 4 GiB |
| Postgres | Langfuse metadata (separate from Brain's Postgres) | 2 CPU / 4 GiB |
| ClickHouse | Trace/observation/score storage (`>= 24.3`) | 2 CPU / 8 GiB |
| Redis (or Valkey) | Queue + cache | 1 CPU / 1.5 GiB |
| MinIO (or any S3-compatible) | Blob store for large objects | 2 CPU / 4 GiB |

> **Architecture implication for Brain's compose:** Brain's `docker-compose.yml` will have roughly **10 services** (brain, brain-postgres, rabbitmq, qdrant, langfuse-web, langfuse-worker, langfuse-postgres, clickhouse, redis, minio). The PROJECT.md "full Docker Compose" constraint is satisfied, but the footprint is non-trivial — recommend documenting a `docker-compose.lite.yml` that omits Langfuse for fast local iteration.

**Integration:**

- LangGraph + Langfuse integration is via the `langfuse.langchain.CallbackHandler` (the v3 SDK is OpenTelemetry-based — `langfuse 4.x` is the right major).
- Pass the handler in `config={"callbacks": [handler]}` when calling `graph.ainvoke(...)`.
- The `metadata` field on the callback is where Brain stamps `botId`, `sessionId`, `provider`, `model` for filterable traces.

**Anti-recommendation:** Do NOT pin to Langfuse v2. v2 is in maintenance; v3 is the active line and the SDK 4.x targets it.

---

## 8. Project Layout, Packaging, Tooling

### Packaging: **`uv` 0.11.16**

**HIGH confidence.** `uv` is now the standard 2025-2026 Python package and project manager. Replaces pip + pip-tools + virtualenv + (much of) poetry in one tool.

| Concern | uv | poetry | pip-tools |
|---|---|---|---|
| Speed | 10-100× faster | Slow | Medium |
| Lockfile | Yes (`uv.lock`) | Yes | Yes (`requirements.txt`) |
| Workspace / monorepo | Yes | Limited | No |
| Docker layer caching | Excellent (`uv sync --frozen --no-dev`) | OK | Good |
| Active development | Heavy | Slowing | Stable |

Use `pyproject.toml` (PEP 621) with `uv` managing both dependencies and the virtualenv. Lock with `uv lock`; install in Docker with `uv sync --frozen --no-install-project --no-dev` then copy source — gives clean cache layers.

### Linting / Formatting: **`ruff` 0.15.14**

Ruff replaces both `flake8` and `black` (it has both linting and a formatter that is black-compatible).

- `ruff check .` — lint
- `ruff format .` — format

Do NOT install `black` separately. Do NOT install `isort` separately. Ruff covers both.

### Type checking: `mypy` (stable) or `pyright`/`ty` (faster). Recommend `mypy` in CI for ecosystem familiarity, leave room to switch to Astral's `ty` once stable.

### Testing

| Package | Version | Purpose |
|---|---|---|
| `pytest` | `9.0.3` | Test runner |
| `pytest-asyncio` | `1.3.0` | Async test support — required for LangGraph + FastAPI tests |
| `httpx` | `0.28.1` | FastAPI test client (already needed runtime) |
| `pytest-cov` | latest | Coverage |
| `testcontainers[postgres,rabbitmq]` | latest | Integration tests against real Postgres + RabbitMQ + Qdrant |

### Pydantic v2 — non-negotiable

`pydantic 2.13.4` everywhere for payload validation. Do NOT mix with `pydantic.v1` shim except where a single legacy library forces it (none in this stack).

### Logging

`structlog 25.5.0` for structured JSON logs that ship to stdout (Docker convention). Bind `bot_id`, `session_id`, `trace_id` (Langfuse) into the context so logs cross-reference traces.

### Recommended `pyproject.toml` (sketch)

```toml
[project]
name = "brain"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi==0.136.1",
  "uvicorn[standard]==0.47.0",
  "pydantic==2.13.4",
  "pydantic-settings==2.14.1",
  "httpx==0.28.1",
  "langgraph==1.2.1",
  "langgraph-checkpoint==4.1.0",
  "langgraph-checkpoint-postgres==3.1.0",
  "langchain-core==1.4.0",
  "langchain-openai==1.2.2",
  "langchain-google-genai==4.2.3",
  "psycopg[binary,pool]==3.3.4",
  "sqlalchemy==2.0.49",
  "alembic==1.18.4",
  "aio-pika==9.6.2",
  "qdrant-client==1.18.0",
  "langfuse==4.6.1",
  "tenacity==9.1.4",
  "tiktoken",
  "structlog==25.5.0",
]

[dependency-groups]
dev = [
  "pytest==9.0.3",
  "pytest-asyncio==1.3.0",
  "pytest-cov",
  "testcontainers[postgres,rabbitmq]",
  "ruff==0.15.14",
  "mypy",
]
```

### Recommended source layout

```
brain/
  src/brain/
    api/            # FastAPI routers (webhook, bots CRUD, health)
    graph/          # LangGraph definitions, nodes, state
    providers/      # OpenAI + Gemini adapters + fallback orchestrator
    memory/         # Short-term (Postgres) + long-term (Qdrant) repos
    queue/          # aio-pika consumer/producer
    persistence/    # SQLAlchemy models, Alembic env
    config.py       # pydantic-settings Settings()
    main.py         # FastAPI app + lifespan (DB pool, MQ, qdrant, checkpointer, langfuse)
  tests/
  alembic/
  docker/
    Dockerfile
    docker-compose.yml
    docker-compose.lite.yml   # no langfuse stack
  pyproject.toml
  uv.lock
  .env.example
```

---

## 9. Docker Compose Topology

### Base image

`python:3.12-slim-bookworm` for Brain.

- 3.12 is the LangGraph-tested major; 3.13 has caveats with some C extensions in this ecosystem still.
- `-slim` over `-alpine`: many ML/embedding deps (and `psycopg[binary]`) ship glibc wheels; alpine forces rebuilds.
- Multi-stage: build stage installs uv + deps; runtime stage copies only the venv + source.

### Pinned service images

| Service | Image | Volume | Healthcheck |
|---|---|---|---|
| `brain` | built locally | — | `GET /health` returns 200 |
| `brain-postgres` | `postgres:17-trixie` | `brain-pg-data:/var/lib/postgresql/data` | `pg_isready -U brain` |
| `rabbitmq` | `rabbitmq:4.1-management-alpine` | `rmq-data:/var/lib/rabbitmq` | `rabbitmq-diagnostics -q ping` |
| `qdrant` | `qdrant/qdrant:v1.18.0` | `qdrant-data:/qdrant/storage` | `wget -qO- localhost:6333/healthz` |
| `langfuse-web` | `langfuse/langfuse:3` | — | `GET /api/public/health` |
| `langfuse-worker` | `langfuse/langfuse-worker:3` | — | internal |
| `langfuse-postgres` | `postgres:17-trixie` | `lf-pg-data:/var/lib/postgresql/data` | `pg_isready` |
| `clickhouse` | `clickhouse/clickhouse-server:24-alpine` | `ch-data:/var/lib/clickhouse` | `wget -qO- localhost:8123/ping` |
| `redis` | `redis:7-alpine` | `redis-data:/data` | `redis-cli ping` |
| `minio` | `minio/minio:latest` (pin a stable tag in practice) | `minio-data:/data` | `mc ready local` |

### Healthchecks pattern

```yaml
brain-postgres:
  image: postgres:17-trixie
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 10s

brain:
  build: .
  depends_on:
    brain-postgres:   { condition: service_healthy }
    rabbitmq:         { condition: service_healthy }
    qdrant:           { condition: service_healthy }
    langfuse-web:     { condition: service_healthy }
```

Use `condition: service_healthy` everywhere downstream of `brain` — without this, Brain races its dependencies on `docker compose up`.

### Network topology

- Single user-defined bridge network (`brain-net`).
- Only `brain` (port 8000) and optionally `langfuse-web` (port 3000), `rabbitmq` management (15672), `qdrant` dashboard (6333) are published to host.
- Postgres, ClickHouse, Redis, MinIO, RabbitMQ AMQP port are **internal-only** unless the developer explicitly opts in via an override file.

### Lite override for fast dev

Provide `docker-compose.lite.yml` that disables Langfuse (4 services dropped: langfuse-web, langfuse-worker, langfuse-postgres, clickhouse — leaving redis/minio also removable). Recommended for inner-loop development; full compose used for staging/observability work.

---

## 10. What NOT to Use (Anti-Recommendations)

| Avoid | Reason | Use Instead |
|---|---|---|
| `asyncpg` as primary Postgres driver | Incompatible with `langgraph-checkpoint-postgres`; forces a custom checkpointer | `psycopg[binary,pool]` 3.3.4 |
| `pika` (sync) | Forces threading hacks in async app | `aio-pika` 9.6.2 |
| `langchain` meta-package | Bloats dependencies; outdated pattern since LangChain 0.3+ | `langchain-core` + targeted provider packages |
| `pydantic` v1 | Out of support direction; ecosystem moved | `pydantic` 2.x |
| `black` + `isort` + `flake8` | Three tools for what ruff does in one | `ruff` (check + format) |
| `poetry` | Slower, harder Docker layering, smaller workspace story | `uv` |
| `chromadb` | Repeated breaking changes; weakest multimodal + filtering story | `qdrant` |
| `langfuse` v2 self-hosted | EOL track — security/feature updates slower | `langfuse` v3 (Docker `langfuse/langfuse:3`) |
| Gemini `text-embedding-004` | Deprecated/shutting down January 2026 | OpenAI `text-embedding-3-small` (or Gemini `gemini-embedding-001`) |
| `python:3.13-slim` (yet) | Some LangChain/Qdrant binary wheels still lag | `python:3.12-slim-bookworm` |
| `python:*-alpine` | musl breaks many ML/extension wheels; longer build times | `python:3.12-slim-bookworm` |
| `:latest` tags in compose | Non-reproducible deploys | Pin every image to an explicit version tag |
| `langgraph` 0.2.x patterns from older tutorials | Import paths and APIs changed in 1.x | Follow `langchain-ai/langgraph` docs for the 1.x line |
| `gunicorn` in front of uvicorn for ASGI | Unnecessary; uvicorn does workers natively now | `uvicorn --workers N` |
| Running Brain's app DB and Langfuse's DB in the **same** Postgres | Coupling failure domains; Langfuse v3 needs ClickHouse/Redis anyway, so it's already a separate stack | Two Postgres containers, separate volumes |

---

## 11. Version Compatibility Notes

| Pair | Note |
|---|---|
| `langgraph` 1.2.1 + `langgraph-checkpoint-postgres` 3.1.0 | Verified compatible (both released within the 1.x line, May 2026). |
| `langgraph-checkpoint-postgres` + `psycopg[binary,pool]` 3.x | Required. Driver must be psycopg v3, NOT psycopg2 and NOT asyncpg. |
| `langfuse` 4.x SDK + Langfuse server v3.x | 4.x SDK targets v3 server (OpenTelemetry). Do not pair 4.x SDK with v2 server. |
| `langchain-openai` 1.2.x + `langchain-core` 1.4.x | Major bump aligned — keep both on 1.x. |
| `langchain-google-genai` 4.2.x + `langchain-core` 1.4.x | Compatible. Provider package was renumbered to 4.x in early 2026. |
| `pydantic` 2.13 + `fastapi` 0.136 + `pydantic-settings` 2.14 | Tested combination. |
| `qdrant-client` 1.18 + `qdrant` server v1.18.0 | Match minor versions where possible; client is generally backward-compatible to server -1 minor. |
| `aio-pika` 9.6 + RabbitMQ 4.1 | AMQP 0.9.1 — compatible. |

---

## 12. Confidence Summary

| Decision | Confidence | Basis |
|---|---|---|
| FastAPI as web framework | HIGH | Universal in 2026 Python LLM stacks; ecosystem alignment |
| LangGraph 1.2.1 + checkpoint 3.1.0 + provider packages | HIGH | Verified live on PyPI 2026-05-21 |
| psycopg v3 (not asyncpg) | HIGH | `langgraph-checkpoint-postgres` is built on psycopg v3 — verified against official docs |
| Qdrant as vector DB | HIGH | Best fit across all 5 Brain-specific criteria; explicit comparison done |
| OpenAI `text-embedding-3-small` default | HIGH | 2026 benchmark + provider alignment with chat LLM |
| `aio-pika` for RabbitMQ | HIGH | Async standard; FastStream considered and deferred |
| Langfuse v3 self-hosted | HIGH (choice) / MEDIUM (compose footprint impact) | Compose footprint is heavier than PROJECT.md may anticipate — flagged for roadmap |
| `uv` + `ruff` + `pytest 9` + pydantic v2 | HIGH | Current 2026 Python tooling consensus |
| Postgres 17, Python 3.12-slim, RabbitMQ 4.1 | HIGH | Verified Docker Hub tags 2026-05-21 |

---

## 13. Roadmap Implications

The stack drives at least these phase-level realities:

1. **First milestone after init** should be "compose stack stands up + health endpoints green" — given the 10-service compose, this is non-trivial and deserves its own phase rather than being bundled into "first feature".
2. **Phase devoted to the LLM provider abstraction + fallback** is needed before any LangGraph node logic, because the provider abstraction is what `tenacity` retries and Langfuse traces hang off.
3. **Embedding configurability is a phase-1 concern**, not an afterthought — choosing dimension at collection-create time in Qdrant means the wrong default is expensive to undo later.
4. **A `docker-compose.lite.yml` (no Langfuse subsystem)** should be delivered in the same phase as the full compose, because Langfuse's 4-service subsystem will make iterative dev painful otherwise.
5. **Alembic migrations** must be in place before the bot-persona CRUD phase — Brain has at least two schema concerns (LangGraph-owned + Brain-owned), and only the Brain-owned one is migrated by Alembic. Document the boundary explicitly.

---

## Sources

Versions verified against PyPI JSON API and Docker Hub tag listings on **2026-05-21**:

- PyPI — langgraph 1.2.1, langgraph-checkpoint 4.1.0, langgraph-checkpoint-postgres 3.1.0, langchain-core 1.4.0, langchain-openai 1.2.2, langchain-google-genai 4.2.3
- PyPI — fastapi 0.136.1, uvicorn 0.47.0, pydantic 2.13.4, pydantic-settings 2.14.1, httpx 0.28.1
- PyPI — psycopg 3.3.4, sqlalchemy 2.0.49, alembic 1.18.4
- PyPI — aio-pika 9.6.2, qdrant-client 1.18.0, langfuse 4.6.1, tenacity 9.1.4, structlog 25.5.0
- PyPI — pytest 9.0.3, pytest-asyncio 1.3.0, ruff 0.15.14, uv 0.11.16
- Docker Hub — postgres 17-trixie, rabbitmq 4.1-management-alpine, qdrant/qdrant v1.18.0, langfuse/langfuse v3.175.0
- GitHub Releases — langgraph 1.2.1 (2026-05-21), qdrant v1.18.0 (2026-05-11), langfuse v3.175.0 (2026-05-21)

Authoritative documentation consulted:

- LangGraph persistence docs (langchain-ai/langgraph) — checkpointer behavior, async setup
- `langgraph-checkpoint-postgres` PyPI page — psycopg v3 requirement, autocommit/row_factory caveats
- Langfuse self-hosting docs — v3 architecture (web + worker + Postgres + ClickHouse + Redis + S3/MinIO)
- Qdrant documentation — named vectors, multimodal patterns, filterable HNSW

Vector DB comparison synthesized from multiple 2026 benchmark and review sources (Qdrant, Weaviate, Milvus, pgvector, Chroma — Docker Compose fit, multi-tenancy, multimodal, license, ops complexity).

Embedding model comparison from 2026 MTEB-derived benchmarks (OpenAI 3-small vs Gemini 004 vs BGE-M3 nDCG@10 scores).

---
*Stack research for: Brain — centralized LangGraph multi-bot AI orchestration service*
*Researched: 2026-05-21*
