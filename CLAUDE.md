## Git Commit Guidelines

**MANDATORY**: All commits must follow the Conventional Commits specification with emojis.

### Commit Message Format

```
<emoji> <type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types with Emojis

| Emoji | Type | When to use |
|-------|------|-------------|
| ✨ | **feat** | A new feature |
| 🐛 | **fix** | A bug fix |
| 📝 | **docs** | Documentation only changes |
| 💄 | **style** | Code style/formatting (whitespace, semicolons, etc) |
| ♻️ | **refactor** | Code change that neither fixes a bug nor adds a feature |
| ⚡️ | **perf** | Performance improvements |
| ✅ | **test** | Adding or updating tests |
| 🔧 | **chore** | Changes to build process or auxiliary tools |
| 🏗️ | **build** | Changes that affect the build system or dependencies |
| 🤖 | **ci** | Changes to CI configuration files and scripts |
| ⏪️ | **revert** | Reverts a previous commit |
| 🔒️ | **security** | Security improvements or fixes |

### Examples

```bash
✨ feat: add endpoint to search chats by botIdentifier

🐛 fix(mongodb): resolve connection timeout in service

📝 docs: update API endpoint examples in README

♻️ refactor(database): simplify database iteration logic

⚡️ perf: optimize message query improving time by 30%

✅ test: add unit tests for authentication service

🔧 chore: configure lint-staged and husky for pre-commit

🏗️ build: adjust GitHub Actions workflow for production

🔒️ security: validate JWT tokens before processing requests
```

### Important Rules

**NEVER** include these lines in commits:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Brain**

Brain is a centralized AI service built with LangGraph (Python) that receives requests from conversational bots (WhatsApp, Telegram, and similar), processes them through multi-provider LLMs (OpenAI and Gemini in v1) with per-bot personas and per-session memory, and returns structured responses. It is designed as the "thinking layer" that any number of bot frontends can delegate to, exposing both an HTTP webhook interface and a RabbitMQ queue interface.

**Core Value:** A single bot frontend can hand a `{ botId, sessionId, conteudo }` payload to Brain and get back a coherent, persona-correct, memory-aware reply — regardless of which LLM provider answers behind the scenes.

### Constraints

- **Tech stack**: Python + LangGraph (Python-first ecosystem; JS port not mature enough).
- **Tech stack**: Postgres as the primary transactional store — used for LangGraph checkpointer, bot definitions, and short-term message history (one DB to operate).
- **Deployment**: Must run end-to-end via `docker compose up` on a developer machine, including Postgres, RabbitMQ, Vector DB, and Langfuse.
- **Configuration**: All providers, queue names, model defaults, and connection strings must be configurable via `.env` — no hardcoded endpoints.
- **Security**: Webhook protected by static Bearer token from env. Internal services (Postgres, RabbitMQ, Vector DB, Langfuse) live on the Docker network.
- **Observability**: Every request must produce a Langfuse trace and an in-response trace of LangGraph node execution for debuggability.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Executive Recommendation
## 1. Web Framework — FastAPI 0.136.1
| Reason | Detail |
|---|---|
| Async-native | Bearer-token webhook needs to call into async LangGraph + async aio-pika + async vector clients without thread-pool bridging. |
| Pydantic v2 first-class | Same models that validate the `{botId, sessionId, conteudo}` HTTP payload are reused for the RabbitMQ message schema and the bot-persona CRUD entities. |
| OpenAPI for free | The bot-CRUD admin API gets `/docs` and `/openapi.json` with zero extra code, which other bot teams can use to generate clients. |
| Dependency injection | `Depends(verify_bearer)` is the canonical, testable shape for the static-token auth requirement. |
| Package | Version | Why |
|---|---|---|
| `fastapi` | `0.136.1` | Web framework |
| `uvicorn[standard]` | `0.47.0` | ASGI server (use `--workers N` behind compose; not gunicorn) |
| `pydantic` | `2.13.4` | Schema validation (Pydantic v2 only — never v1) |
| `pydantic-settings` | `2.14.1` | `.env` → typed `Settings` class (required by the all-via-`.env` constraint) |
| `httpx` | `0.28.1` | Outbound HTTP (test client + any outbound webhook returns) |
| Alternative | Verdict | Rationale |
|---|---|---|
| Litestar 2.x | Reject | Smaller ecosystem, no LangChain/Langfuse examples written against it. FastAPI is what every LangGraph tutorial and Langfuse cookbook targets. |
| Starlette (bare) | Reject | Forfeits pydantic body validation, dependency injection, and OpenAPI — all of which Brain needs. |
| Flask / Quart | Reject | Sync-rooted; mixing with async LangGraph is friction. |
| Django + DRF | Reject | Too heavy for a single-service backend with no HTML/ORM-coupled views. |
## 2. LangGraph Core — 1.2.1 (released 2026-05-21)
| Package | Version | Purpose |
|---|---|---|
| `langgraph` | `1.2.1` | Graph runtime, `StateGraph`, `Command`, persistence API |
| `langgraph-checkpoint` | `4.1.0` | Base checkpoint interface (transitive, but pin to avoid surprises) |
| `langgraph-checkpoint-postgres` | `3.1.0` | `PostgresSaver` + `AsyncPostgresSaver` (see §3) |
| `langchain-core` | `1.4.0` | Message types, runnables — required by every provider adapter |
| `langchain-openai` | `1.2.2` | `ChatOpenAI` (GPT-4.1) + `OpenAIEmbeddings` |
| `langchain-google-genai` | `4.2.3` | `ChatGoogleGenerativeAI` (Gemini 2.5 Flash) + Gemini embeddings |
- Do **not** install `langchain` (the meta package). Install only the focused `langchain-core` + provider packages. The meta package pulls dozens of unwanted dependencies and is no longer the recommended shape since LangChain 0.3+.
- `langgraph` 1.x changed several import paths vs 0.2.x tutorials — always reference the official `langchain-ai/langgraph` repo, not blog posts.
- The provider-fallback requirement is satisfied by wrapping `ainvoke` calls in `tenacity` retry plus a custom orchestration node — don't rely on undocumented LangChain "fallback chains" for multi-provider failover; they exist but mask error types Brain wants to log to Langfuse.
| Library | Version | When |
|---|---|---|
| `tenacity` | `9.1.4` | Retry policy for transient LLM/provider errors; fallback trigger |
| `tiktoken` | latest | Token counting for usage in response payload (OpenAI tokenizer) |
## 3. Postgres Checkpointer + Driver
| Component | Choice | Version | Why |
|---|---|---|---|
| Server | Postgres | `17-trixie` (Docker `postgres:17-trixie`) | Current stable major; `pgvector` extension compatible if Brain ever wants pgvector for any internal use. |
| Python driver | `psycopg[binary,pool]` | `3.3.4` | Required by `langgraph-checkpoint-postgres`. Async support is native (`psycopg.AsyncConnection`, `AsyncConnectionPool`). |
| Checkpointer | `langgraph-checkpoint-postgres` | `3.1.0` | Official, async-capable via `AsyncPostgresSaver.from_conn_string(...)`. |
| ORM (bot-persona CRUD) | `SQLAlchemy` | `2.0.49` | For the bot/persona/short-term-history tables that are NOT LangGraph checkpoint tables. v2 native async. |
| Migrations | `Alembic` | `1.18.4` | Standard SQLAlchemy migration tool. |
## 4. Vector Database — **Qdrant v1.18.0**
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
| Alternative | Use when |
|---|---|
| **pgvector** | If Brain decided to drop the dedicated vector DB entirely and accept that multimodal will be slow/bolted-on. Reduces compose by one service. Reconsider only if scale stays under ~500K vectors AND multimodal is deprioritized. |
| **Weaviate** | If multi-tenancy (one tenant = one bot) becomes a hard architectural requirement and Brain wants the platform to enforce it rather than payload filtering. |
| **Milvus** | Only at >100M vectors. Brain is nowhere near this. |
| Package | Version | Purpose |
|---|---|---|
| `qdrant-client` | `1.18.0` | Async + sync Python client |
| Docker image | `qdrant/qdrant:v1.18.0` | Server (pin to a version tag, not `:latest`) |
## 5. Embedding Model — Default: **OpenAI `text-embedding-3-small`**
- Highest accuracy/cost ratio of any commercial embedding model in 2026 benchmarks (nDCG@10 0.689 vs Gemini text-embedding-004 0.538).
- Brain already integrates OpenAI for chat — same API key, same SDK, same auth — zero additional ops surface.
- 1536 dimensions is the Qdrant sweet spot (good recall, modest memory).
- Supports dimension reduction (Matryoshka) if Brain later wants 512-d for memory savings.
- A Brain instance running with Gemini-only credentials can fall back to Gemini embeddings.
- A future air-gapped deployment can use BGE-M3 via Hugging Face TEI sidecar.
| Provider | Model | Dim | When |
|---|---|---|---|
| **OpenAI (default)** | `text-embedding-3-small` | 1536 | v1 default; best quality/cost |
| OpenAI (premium) | `text-embedding-3-large` | 3072 | If recall is insufficient; ~7× cost |
| Google | `gemini-embedding-001` | 768 / 3072 | If OpenAI is unavailable; the older `text-embedding-004` model is being shut down January 2026 — do NOT use it. Use `gemini-embedding-001` or later. |
| BGE / open-source | `BAAI/bge-m3` | 1024 | Air-gapped only; multilingual; runs via Hugging Face TEI sidecar |
## 6. RabbitMQ Client — **aio-pika 9.6.2**
| Reason | Detail |
|---|---|
| Async-native | Composes with FastAPI lifespan + LangGraph `ainvoke`. |
| Robust reconnect | `connect_robust()` recovers declared queues/exchanges/consumer state on broker restarts — Brain's compose stack will restart RabbitMQ during dev. |
| Publisher confirms | Available — needed so Brain can guarantee `brain.out` writes before acking `brain.in`. |
| Maintained | Active in 2026, Python 3.10+ supported. |
| Package | Version |
|---|---|
| `aio-pika` | `9.6.2` |
| Docker image | `rabbitmq:4.1-management-alpine` (current stable 4.1.x, has the management UI on `:15672` for dev) |
## 7. Langfuse — Server v3.175.0, SDK `langfuse` 4.6.1
| Component | Version | Notes |
|---|---|---|
| `langfuse` (Python SDK) | `4.6.1` | OpenTelemetry-based, native LangChain/LangGraph callback. |
| `langfuse/langfuse` (server) | `3.175.0` (Docker `langfuse/langfuse:3`) | Web + worker |
| Service | Purpose | Min resources |
|---|---|---|
| `langfuse-web` | UI + ingestion API | 2 CPU / 4 GiB |
| `langfuse-worker` | Async event processing | 2 CPU / 4 GiB |
| Postgres | Langfuse metadata (separate from Brain's Postgres) | 2 CPU / 4 GiB |
| ClickHouse | Trace/observation/score storage (`>= 24.3`) | 2 CPU / 8 GiB |
| Redis (or Valkey) | Queue + cache | 1 CPU / 1.5 GiB |
| MinIO (or any S3-compatible) | Blob store for large objects | 2 CPU / 4 GiB |
- LangGraph + Langfuse integration is via the `langfuse.langchain.CallbackHandler` (the v3 SDK is OpenTelemetry-based — `langfuse 4.x` is the right major).
- Pass the handler in `config={"callbacks": [handler]}` when calling `graph.ainvoke(...)`.
- The `metadata` field on the callback is where Brain stamps `botId`, `sessionId`, `provider`, `model` for filterable traces.
## 8. Project Layout, Packaging, Tooling
### Packaging: **`uv` 0.11.16**
| Concern | uv | poetry | pip-tools |
|---|---|---|---|
| Speed | 10-100× faster | Slow | Medium |
| Lockfile | Yes (`uv.lock`) | Yes | Yes (`requirements.txt`) |
| Workspace / monorepo | Yes | Limited | No |
| Docker layer caching | Excellent (`uv sync --frozen --no-dev`) | OK | Good |
| Active development | Heavy | Slowing | Stable |
### Linting / Formatting: **`ruff` 0.15.14**
- `ruff check .` — lint
- `ruff format .` — format
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
### Logging
### Recommended `pyproject.toml` (sketch)
### Recommended source layout
## 9. Docker Compose Topology
### Base image
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
### Network topology
- Single user-defined bridge network (`brain-net`).
- Only `brain` (port 8000) and optionally `langfuse-web` (port 3000), `rabbitmq` management (15672), `qdrant` dashboard (6333) are published to host.
- Postgres, ClickHouse, Redis, MinIO, RabbitMQ AMQP port are **internal-only** unless the developer explicitly opts in via an override file.
### Lite override for fast dev
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
## 13. Roadmap Implications
## Sources
- PyPI — langgraph 1.2.1, langgraph-checkpoint 4.1.0, langgraph-checkpoint-postgres 3.1.0, langchain-core 1.4.0, langchain-openai 1.2.2, langchain-google-genai 4.2.3
- PyPI — fastapi 0.136.1, uvicorn 0.47.0, pydantic 2.13.4, pydantic-settings 2.14.1, httpx 0.28.1
- PyPI — psycopg 3.3.4, sqlalchemy 2.0.49, alembic 1.18.4
- PyPI — aio-pika 9.6.2, qdrant-client 1.18.0, langfuse 4.6.1, tenacity 9.1.4, structlog 25.5.0
- PyPI — pytest 9.0.3, pytest-asyncio 1.3.0, ruff 0.15.14, uv 0.11.16
- Docker Hub — postgres 17-trixie, rabbitmq 4.1-management-alpine, qdrant/qdrant v1.18.0, langfuse/langfuse v3.175.0
- GitHub Releases — langgraph 1.2.1 (2026-05-21), qdrant v1.18.0 (2026-05-11), langfuse v3.175.0 (2026-05-21)
- LangGraph persistence docs (langchain-ai/langgraph) — checkpointer behavior, async setup
- `langgraph-checkpoint-postgres` PyPI page — psycopg v3 requirement, autocommit/row_factory caveats
- Langfuse self-hosting docs — v3 architecture (web + worker + Postgres + ClickHouse + Redis + S3/MinIO)
- Qdrant documentation — named vectors, multimodal patterns, filterable HNSW
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
