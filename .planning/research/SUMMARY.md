# Project Research Summary

**Project:** Brain — centralized LangGraph multi-bot AI orchestration service
**Domain:** Python LLM orchestration backend (LangGraph + multi-provider LLMs + vector memory + dual ingress)
**Researched:** 2026-05-21
**Confidence:** HIGH

## Executive Summary

Brain is a Python LangGraph backend that brokers conversational requests from any number of bot adapters (WhatsApp, Telegram, etc.) to multiple LLM providers (OpenAI + Gemini in v1), with per-bot personas in Postgres, session-isolated short-term + vector long-term memory, and dual ingress (HTTP webhook + RabbitMQ). Research confirms this is a well-trodden 2026 pattern with a tight stack: **FastAPI + LangGraph 1.2 + Postgres 17 (psycopg v3, NOT asyncpg) + Qdrant + Langfuse v3 + aio-pika**, deployed via Docker Compose. Versions were verified live on PyPI / Docker Hub on the research date.

The expert-recommended approach is a **"shared service waist"** architecture: both ingresses translate to a single Pydantic `BrainRequest` and call one `BrainService.handle_request()`, which invokes a linear LangGraph (load persona → fetch short-term + long-term memory → build messages → call LLM with `with_fallbacks` → persist → embed → respond). Provider failover lives *inside* the `call_llm` node using LangChain's `with_fallbacks`, not as graph edges, so Langfuse traces stay clean. Sessions are serialized per `(botId, sessionId)` via an in-process `asyncio.Lock` registry — the single most important concurrency rule because `AsyncPostgresSaver` does not protect the read-mutate-write turn boundary.

The dominant risks are **silent data corruption at the foundations**: 12 of 44 catalogued pitfalls are CRITICAL severity and cluster heavily in the architecture phase — checkpointer version pinning, async-everywhere driver discipline, `thread_id = f"{botId}:{sessionId}"` (never bare sessionId), DLQ topology, RabbitMQ manual ack + consumer timeout, and embedding dimension being locked at collection-create time. The roadmap must front-load foundations, not race to a first webhook.

## Key Findings

### Recommended Stack

(Full detail in `.planning/research/STACK.md`. All versions verified live 2026-05-21.)

- **Runtime:** Python 3.12-slim-bookworm (NOT alpine; NOT 3.13 — ML wheels lag)
- **Web:** FastAPI 0.136.1 + Uvicorn 0.47.0 + Pydantic 2.13.4 + pydantic-settings 2.14.1
- **Graph:** langgraph 1.2.1 + langgraph-checkpoint-postgres 3.1.0 + langchain-core 1.4.0
- **LLMs:** langchain-openai 1.2.2 (GPT-4.1) + langchain-google-genai 4.2.3 (Gemini 2.5 Flash)
- **DB driver:** `psycopg[binary,pool]` 3.3.4 — **NOT asyncpg** (incompatible with the official LangGraph checkpointer)
- **DB server:** Postgres 17-trixie; SQLAlchemy 2.0.49 async + Alembic 1.18.4 for the Brain-owned schema
- **Queue:** RabbitMQ 4.1-management-alpine + aio-pika 9.6.2 (NOT sync `pika`)
- **Vector DB:** **Qdrant v1.18.0** + qdrant-client 1.18.0 — won the comparison vs Weaviate/Milvus/pgvector/Chroma on multimodal headroom, single-container compose fit, and filterable HNSW
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dims) default; pluggable via env
- **Tracing:** Langfuse server v3.175 + SDK 4.6.1 (v3 needs Postgres + ClickHouse + Redis + MinIO — 4 extra services)
- **Tooling:** uv 0.11.16 + ruff 0.15.14 + pytest 9.0.3 + pytest-asyncio 1.3.0 + structlog 25.5.0

### Expected Features

Full landscape in `.planning/research/FEATURES.md` (20 table stakes + 17 differentiators + 13 anti-features).

**Must have in v1** (table stakes whose absence blocks production use):

| ID | Feature | Phase fit |
|---|---|---|
| TS-1, TS-20 | Bearer-token auth + provider keys via `.env` | Foundations / Webhook |
| TS-2, TS-3 | `/healthz` + `/readyz` | Foundations |
| TS-4 | Structured error envelope with stable codes | Webhook |
| TS-5 | `Idempotency-Key` (Postgres-backed) — covers webhook retries AND at-least-once queue delivery | Ingress |
| TS-6 | RabbitMQ manual ack + prefetch + nack discipline | RabbitMQ ingress |
| TS-7 | DLX + `brain.dlq` for poison messages | RabbitMQ ingress |
| TS-8, TS-9 | `tenacity` retry + per-provider timeout (fires fallback) | Providers |
| TS-10 | Graceful shutdown with in-flight drain | Foundations |
| TS-11, TS-12 | Pydantic validation + 32KB payload cap | Webhook |
| TS-13 | OpenAPI `/docs` + AsyncAPI doc for RabbitMQ | Bot CRUD / RabbitMQ |
| TS-14 | Bot CRUD with append-only `bot_audit_log` | Bot CRUD |
| TS-15 | `schema_version` field on all payloads | Foundations |
| TS-16 | Session-isolated memory; cross-session-leak test | Memory |
| TS-17 | `traceId` (Langfuse) in response envelope | Langfuse / Webhook |
| TS-18 | `DB_POOL_SIZE`, `RABBIT_PREFETCH`, `MAX_CONCURRENT_LLM_CALLS` via `.env` | Foundations |
| TS-19 | AMQP `correlation_id` round-tripped | RabbitMQ ingress |

**Free differentiators to include in v1** (cheap now, expensive to retrofit):

- **D-1, D-2, D-3 — Langfuse tagging convention** (`bot:{id}`, `session:{id}`, `provider`, `model`, `fallback_used`). Defining later requires dashboard split or backfill.
- **D-11 — Per-bot model override.** Optional `preferred_provider` / `preferred_model` columns on `bots`; falls back to env default when null. One-column migration since the provider abstraction already exists.

**Defer to v1.x:** D-4 Langfuse Prompt CMS migration, D-6 structured outputs, D-8 exact-match cache, D-10 per-bot rate limit, D-13 PII redaction (LGPD-relevant), D-15 async webhook callback, D-16 memory summarization.

**Anti-features (deliberately NOT in v1):**

- AF-1 No chat UI / playground — integrators use `curl` + `/docs` + Langfuse trace replay.
- AF-2 No pgvector shortcut — multimodal headroom is locked scope.
- AF-3 No supervisor / multi-agent patterns — keep one linear graph per request.
- AF-4 No cross-session / userId memory — explicitly out of scope.
- AF-5 No streaming (SSE/WebSocket).
- AF-6 No local LLM providers (Ollama) in v1.
- AF-7 No direct image/video ingest — text descriptions only.
- AF-9 No per-end-user auth — single Bearer token between trusted services.
- AF-10 No custom prompt-management UI — Langfuse Prompt CMS fills that gap in v1.x.
- AF-13 No false-confidence prompt-injection guardrails — honest threat model + mitigations only.

### Architecture Approach

(Full detail in `.planning/research/ARCHITECTURE.md`.) Design: **two ingresses, one shared service, one linear LangGraph**.

**Major components:**

1. `api/` (FastAPI) — `/v1/webhook`, Bearer auth, `/healthz`, `/readyz`, bot CRUD. HTTP translation layer only.
2. `workers/` (aio-pika) — `connect_robust` consumer on `brain.in`, publishes to `brain.out`, manual ack, DLQ.
3. `service/` — `BrainService.handle_request` shared waist. Owns per-session lock registry, persona pre-load, Langfuse root span, `graph.ainvoke`, response assembly.
4. `graph/` — `BrainState` TypedDict + 8 nodes: `load_persona → fetch_short_term + fetch_long_term → build_messages → call_llm → persist_message → embed_and_store → build_response`. Provider fallback inside `call_llm` via `with_fallbacks`.
5. `providers/` — `LLMProvider` protocol + `OpenAIProvider`, `GeminiProvider`, `ProviderRouter`. Add a third provider by dropping one file + registering.
6. `memory/` — `ShortTermRepo` (Postgres last-N), `LongTermRepo` (Qdrant semantic recall), `EmbeddingClient`.
7. `personas/` — `PersonaRepo` over `bots` table, in-process TTL cache (~60s).
8. `vectordb/` — `VectorStore` protocol + `QdrantStore` concrete. Single collection `brain_memory` with `(bot_id, session_id)` payload filter on filterable HNSW. Escape hatch: collection-per-bot.
9. `observability/` — Langfuse callback handler injected at every `graph.ainvoke`.
10. `config/` — single `Settings(BaseSettings)` validated at startup.
11. `db/` — psycopg async pool + SQLAlchemy 2.x async + Alembic. Hosts `AsyncPostgresSaver`. Two schemas: `langgraph.*` (checkpointer) + `brain.*` (Alembic).

**Key patterns:** per-session async lock keyed by `f"{bot_id}:{session_id}"`; provider fallback via `with_fallbacks` (not edges); `thread_id = f"{bot_id}:{session_id}"` (never bare sessionId); effect nodes (`persist_message`, `embed_and_store`) at end with idempotency keys `sha256(bot_id|session_id|content)` + upsert / `ON CONFLICT DO NOTHING`.

### Critical Pitfalls (top 10)

(Full catalog in `.planning/research/PITFALLS.md`.)

1. **1.1 — Checkpointer schema breaks across minor versions.** Pin `langgraph`, `langgraph-checkpoint`, `langgraph-checkpoint-postgres` exactly; ship a "legacy checkpoint replay" fixture test. [Foundations]
2. **10.1 — SessionId collisions across bots leak history.** `thread_id = f"{bot_id}:{session_id}"` always; helper function; lint rule. [Foundations]
3. **10.2 — Vector queries missing `bot_id` filter leak memory.** Wrap Qdrant client; raise if `filter` lacks `bot_id`; ban raw client outside `memory/`. [Foundations]
4. **3.1 — Concurrent same-session requests produce stale "last 10".** Per-`(bot_id, session_id)` `asyncio.Lock` spanning the whole turn. [Foundations / Memory]
5. **3.2 — Embedding model swap makes old vectors incomparable.** Store `embedding_model_id` per vector; switching = new collection + backfill. Dim locked at create time. [Foundations]
6. **4.1 + 4.2 — Auto-ack loses messages on crash; manual ack + long LLM exceeds RabbitMQ delivery timeout.** Manual ack only; `prefetch_count=1`; per-LLM `httpx` timeout; explicit `consumer_timeout` in rabbitmq.conf. [RabbitMQ]
7. **4.3 — No DLX = poison-message infinite loop.** Declare `brain.in` with `x-dead-letter-exchange=brain.dlx`; `nack(requeue=False)` on unrecoverable. [RabbitMQ]
8. **2.2 — Partial response on provider A then fallback to B inflates cost and breaks attribution.** All-or-nothing: discard partial; tag discarded span `metadata={"discarded": true}`; cost code filters `discarded=false`. [Providers]
9. **5.1 — Bearer token leaked into Langfuse traces / logs.** Strip `Authorization` in middleware before any logging or tracing; Langfuse `mask` callback; canary-token regression test. [Webhook + Observability]
10. **8.1 — Langfuse outage takes Brain down.** Fire-and-forget callback config; try/except swallow; circuit breaker after N failures. [Observability]

Other CRITICALs addressed: 5.3 (.env in git — gitleaks + .gitignore), 1.4 (effect-node replay — idempotency keys on every write).

## Implications for Roadmap

Suggested phase structure: **9 phases**, reconciling ARCHITECTURE build order with FEATURES MVP and PITFALLS phase mapping.

### Phase 1: Foundations & Compose Skeleton

**Rationale:** All 12 CRITICAL pitfalls cluster here; the 10-service Docker Compose footprint (Brain + Postgres + RabbitMQ + Qdrant + Langfuse-web + Langfuse-worker + Langfuse-Postgres + ClickHouse + Redis + MinIO) is non-trivial and must work before any feature work. Locks foundational conventions that are expensive to reverse.
**Delivers:** Walking skeleton — `docker compose up` brings everything to healthy; FastAPI app with `/healthz`, `/readyz`; Pydantic `Settings`; `pyproject.toml` with pinned versions; multi-stage Dockerfile (`base → dev → prod`); `docker-compose.lite.yml` (no Langfuse subsystem); Alembic init; `brain-migrate` init container; two Postgres schemas (`langgraph.*` + `brain.*`); gitleaks + `.env` hygiene; structlog.
**Addresses:** TS-2, TS-3, TS-15, TS-18, TS-20.
**Avoids:** 1.1, 1.2, 4.4, 5.3, 5.4, 6.1, 6.2, 6.4, 7.1, 7.2.
**Locks decisions:** `thread_id` helper, embedding dim, single-vs-per-bot Qdrant collection (recommend single + filter).

### Phase 2: Bot Persona CRUD + Audit

**Rationale:** Personas are an input to the graph; CRUD is isolatable and testable without an LLM call.
**Delivers:** `bots` table with versioning columns (`id`, `version`, `deleted_at`, `preferred_provider`, `preferred_model`, `system_prompt`, `langfuse_prompt_id` placeholder); `bot_audit_log` append-only; `POST/GET/PUT/DELETE /v1/bots`; soft-delete semantics; prompt-size CHECK constraint; persona TTL cache (~60s).
**Addresses:** TS-14, D-11; sets stage for D-4 migration.
**Avoids:** 9.1 (persona pinned per session), 9.2 (soft-delete + 410), 9.3 (size cap).

### Phase 3: Minimal Webhook + Single-Node Graph

**Rationale:** Prove end-to-end request flow with simplest possible graph (just `call_llm` against OpenAI hardcoded) before layering on multi-provider, memory, or RabbitMQ. First "it works" milestone.
**Delivers:** `/v1/webhook` with Bearer auth + Pydantic `BrainRequest` + 32KB cap + structured errors; `BrainService.handle_request` shared waist; one-node LangGraph; response envelope with `traceId` placeholder + `node_trace` + model/usage.
**Addresses:** TS-1, TS-4, TS-11, TS-12, TS-15, TS-17 (placeholder).
**Avoids:** 5.1, 1.3, 1.5.

### Phase 4: Langfuse Wiring

**Rationale:** Pulled forward because traces save hours during memory + provider debugging; tagging convention is cheaper to define once than to backfill.
**Delivers:** Langfuse callback handler attached to every `graph.ainvoke`; root span opened in middleware / worker; tag convention frozen; `traceId` populated in response; circuit breaker.
**Addresses:** TS-17, D-1, D-2.
**Avoids:** 8.1, 8.2.

### Phase 5: Multi-Provider + Fallback

**Rationale:** Locks the provider abstraction *before* memory adds complexity; trivially testable in isolation.
**Delivers:** `LLMProvider` protocol + `OpenAIProvider` + `GeminiProvider`; `ProviderRouter` via `with_fallbacks(exceptions_to_handle=(...))`; `ProviderError` taxonomy (TRANSIENT / RATE_LIMIT / BAD_INPUT / CONTENT_POLICY / AUTH); `tenacity` retry with exponential backoff + jitter; per-provider timeout from env; honor `Retry-After`; per-provider token counters (`tiktoken` for OpenAI, `count_tokens` for Gemini).
**Addresses:** TS-8, TS-9, D-3, D-11 wiring.
**Avoids:** 2.1, 2.2, 2.3, 2.5.

### Phase 6: Memory (Short-Term + Postgres Checkpointer)

**Rationale:** Independent of vector DB; immediate UX win. Locking introduced here because memory is the first thing that races.
**Delivers:** `messages` table (in `brain` schema); `ShortTermRepo` (last-10 per `(bot_id, session_id)`); `fetch_short_term_memory` + `persist_message` nodes; `AsyncPostgresSaver` wired with `thread_id = f"{bot_id}:{session_id}"`; per-session `asyncio.Lock` registry; integration test that fires 5 concurrent requests on same session and asserts strict ordering; cross-session-leak test.
**Addresses:** TS-16.
**Avoids:** 3.1, 10.1, 1.4.

### Phase 7: Vector Memory (Qdrant)

**Rationale:** Requires schema + short-term plumbing stable; embedding latency is on hot path so design for parallelism from the start.
**Delivers:** `VectorStore` protocol + `QdrantStore`; single collection `brain_memory` with filterable HNSW on `(bot_id, session_id)`; `EmbeddingClient` (OpenAI `text-embedding-3-small` default, pluggable); `fetch_long_term_memory` + `embed_and_store` nodes; vector upsert with `sha256(bot_id|session_id|content_hash)`; `asyncio.gather` over short-term + long-term fetches; embedding cache by content hash; TTL policy documented; `VectorMemory.recall(bot_id, session_id, query)` is the only callable API (linter rule).
**Addresses:** Long-term memory + TS-16 vector side.
**Avoids:** 3.2, 3.3, 3.5, 10.2, 10.3.

### Phase 8: RabbitMQ Ingress

**Rationale:** Validates "two ingress, one service" symmetry. Doing it after the HTTP path is fully working means only one new variable when debugging.
**Delivers:** `workers/consumer.py` using `aio-pika.connect_robust`; centralized `topology.py`; `brain-topology-init` init container; consumers `passive=True`; `brain.in` with DLX → `brain.dlx` → `brain.dlq`; manual ack only; `prefetch_count=1`; explicit `consumer_timeout`; per-LLM `httpx` timeout < ack timeout; `correlation_id` round-tripped; publisher confirms on `brain.out`; AsyncAPI doc; FastAPI lifespan starts/stops consumer alongside web; graceful shutdown drains; idempotency-key (TS-5) backed by Postgres for both ingresses.
**Addresses:** TS-5, TS-6, TS-7, TS-10, TS-13 (AsyncAPI), TS-19.
**Avoids:** 4.1, 4.2, 4.3, 4.4, 4.5.

### Phase 9: Hardening & Production-Readiness

**Rationale:** Items that need real traffic data to size, or operational concerns that don't block v1 launch but block a real deployment.
**Delivers:** Checkpoint retention (nightly DELETE keeping last 20 per thread + 24h); vector TTL + reindex automation; DLQ replay tooling; bearer token list (`BRAIN_AUTH_TOKENS=tok1,tok2`) for rotation; PII redaction on Langfuse traces (Presidio or Langfuse `mask`); LGPD review; secrets-beyond-`.env` (Docker `secrets:`, SOPS or 1Password); backup/restore drill (both schemas atomic); README + runbook; metrics endpoints; capacity model.
**Addresses:** Polish + operability.
**Avoids:** 1.6, 3.4, 5.2, 5.5, 6.3, 6.5, 7.3.

### Phase Ordering Rationale

- Foundations first because 12 of 12 CRITICAL architecture-layer pitfalls cluster here.
- CRUD before graph: personas are an input; testable without LLM.
- Minimal webhook before multi-provider so "it works" comes early.
- Langfuse pulled forward (Phase 4) so every later phase benefits from trace visibility.
- Provider abstraction before memory: independently testable.
- Short-term before vector: shared per-session lock infrastructure; vector adds parallel-fetch concern.
- RabbitMQ last among ingresses because queue debugging is the highest-overhead failure mode.
- Hardening last because retention, TTL, backup sizing need real shapes.

### Research Flags

Phases likely needing deeper research (`/gsd-research-phase`):

- **Phase 1:** Langfuse v3 self-hosting subsystem (5 sidecars) — focused compose research pass; Alembic + LangGraph schemas interplay (issue #465).
- **Phase 4:** Tag conventions, mask callbacks, circuit breaker, trace-context propagation across async boundaries (PITFALL 8.3).
- **Phase 5:** `ProviderError` taxonomy mapping for both OpenAI and Gemini (PITFALL 2.1); partial-response policy (PITFALL 2.2).
- **Phase 7:** Qdrant filterable HNSW tuning at scale; named-vector schema for future multimodal; embedding cache key design.
- **Phase 8:** `consumer_timeout` vs prefetch vs per-LLM-call timeout interaction (PITFALL 4.2).

Phases with standard patterns (likely skip research-phase): Phase 2 (CRUD), Phase 3 (minimal webhook), Phase 6 (short-term memory — only novelty is per-session lock), Phase 9 (well-documented ops).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified live on PyPI / Docker Hub 2026-05-21; explicit Qdrant comparison matrix; psycopg-v3 requirement verified against official docs. |
| Features | HIGH | Locked PROJECT.md scope is comprehensive; table-stakes gap analysis grounded in official Langfuse + LangGraph + RabbitMQ docs (HIGH) and 2026 LLM gateway references (MEDIUM). |
| Architecture | HIGH | Locked stack tightly constrains design space; per-session lock grounded in upstream issue #7259. |
| Pitfalls | HIGH | 44 pitfalls sourced from real GitHub issues, official docs, 2025-2026 incident reports. |

**Overall confidence:** HIGH.

### Locked Open Questions (need user confirmation or explicit deferral)

1. **Embedding dimension** locked at Qdrant collection-create time. Recommend OpenAI `text-embedding-3-small` (1536 dims); named-vector slots reserved for `image`/`video` for future multimodal. **Decision required before Phase 7.**
2. **Single Qdrant collection (`brain_memory`) + payload filter vs collection-per-bot.** Recommend single + filter (operationally simpler; Qdrant's filterable HNSW is first-class). Collection-per-bot kept as documented escape hatch. **Recorded in Phase 1; revisit at scale in Phase 9.**
3. **Langfuse Prompt CMS (D-4) migration timing.** v1 keeps personas in Postgres as authoritative. v1.x migrates: design `bots` row with `langfuse_prompt_id` placeholder now so migration is cheap (store *either* `system_prompt` OR `langfuse_prompt_id`, never both authoritative). **Phase 2 must accommodate.**
4. **Idempotency cache: Postgres vs Redis.** Recommend **Postgres** (already in stack, one fewer service surface, TTL via small table with nightly cleanup). Redis is in compose for Langfuse but adding Brain dependency on it grows failure domain. **Decision required at Phase 8.**
5. **Two Postgres instances confirmed:** `brain-postgres` (LangGraph checkpointer + brain schemas) and `langfuse-postgres` (Langfuse metadata). Never share. **Recorded in Phase 1.**

### Gaps to Address During Planning

- **Capacity model:** No real traffic data yet. Ship defaults in Phase 1 (in ARCHITECTURE.md), revisit Phase 9 with first-week metrics.
- **Multi-replica deploy:** v1 uses in-process lock — works for one Brain instance only. Document limitation in Phase 6; design Redis-distributed lock as Phase 9+ / v1.x item if horizontal scale needed.
- **Embedding-async-write:** v1 keeps `embed_and_store` on hot path (simpler, correct). Moving to background `asyncio.create_task` or dedicated embed-worker is Phase 9 follow-up if p95 latency budget exceeded.
- **LGPD / PII review timing:** Brain's audience is Brazilian. PII redaction (D-13) was deferred to v1.x but legal may surface it earlier. Flag during Phase 4 — redaction hook cheaper to ship with initial tagging than retrofit.

## Sources

### Primary (HIGH)

- PyPI JSON API + Docker Hub tag listings (verified 2026-05-21) — see `STACK.md` for full list
- LangGraph persistence docs; `langgraph-checkpoint-postgres` PyPI page; AsyncPostgresSaver reference
- Langfuse self-hosting docs (v3 architecture); Langfuse + LangGraph cookbook
- Qdrant documentation (named vectors, filterable HNSW)
- LangChain `RunnableWithFallbacks` reference
- RabbitMQ Consumers docs (delivery ack timeout, prefetch)
- Langfuse incident report Nov 2025 (circuit-breaker rationale)
- GitHub issues: langgraph#5862, #6137, #7259, #5883; langgraphjs#1138; pgvector#442; docs#465

### Secondary (MEDIUM)

- Top 5 LLM Gateways 2026 (Maxim); CloudAMQP prefetch optimization; Michal Drozd RabbitMQ ack contracts; pgvector DBA guide March 2026; Python Graceful Shutdown in Kubernetes (OneUptime); 2026 MTEB-derived embedding benchmarks.

### Tertiary

- LangGraph multi-agent orchestration guide (Latenode) — informs AF-3; Best AI guardrails platforms 2026 — informs AF-13.
