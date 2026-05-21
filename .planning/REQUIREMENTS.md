# Requirements: Brain

**Defined:** 2026-05-21
**Core Value:** A single bot frontend can hand a `{ botId, sessionId, conteudo }` payload to Brain and get back a coherent, persona-correct, memory-aware reply — regardless of which LLM provider answers behind the scenes.

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Foundations

- [ ] **FOUND-01**: Project runs on Python 3.12 with pinned dependencies managed by `uv`
- [ ] **FOUND-02**: All LangGraph and checkpointer versions are exact-pinned (no minor-version drift)
- [ ] **FOUND-03**: Service exposes `/healthz` (liveness) and `/readyz` (dependency check: Postgres, RabbitMQ, Qdrant) endpoints
- [ ] **FOUND-04**: All connection details, model defaults, queue names, embedding settings, and Bearer token come from `.env` (no hardcoded endpoints)
- [ ] **FOUND-05**: Configuration is validated at startup via Pydantic Settings; service fails fast on missing or malformed env values
- [ ] **FOUND-06**: Postgres uses `psycopg[binary,pool]` v3 driver throughout (asyncpg is forbidden — incompatible with LangGraph checkpointer)
- [ ] **FOUND-07**: Two Postgres schemas exist: `langgraph.*` owned by the checkpointer's `.setup()`, `brain.*` owned by Alembic migrations
- [ ] **FOUND-08**: Helper function `thread_id(bot_id, session_id) -> str` is the only sanctioned way to build LangGraph thread IDs (enforced by lint rule)
- [ ] **FOUND-09**: Service performs graceful shutdown — drains in-flight HTTP requests and AMQP messages before exit
- [ ] **FOUND-10**: All structured logs and Langfuse traces use JSON via `structlog`; no `print` or stdlib logging in production code
- [ ] **FOUND-11**: All incoming payloads include a `schema_version` field; Brain rejects unsupported versions explicitly
- [ ] **FOUND-12**: `.env` files are gitignored; `gitleaks` runs in pre-commit to prevent secret leakage

### Authentication & Security

- [ ] **AUTH-01**: Webhook endpoints require a Bearer token from `BRAIN_AUTH_TOKEN` env var (constant-time comparison)
- [ ] **AUTH-02**: `Authorization` header is stripped before any logging, error response, or Langfuse trace
- [ ] **AUTH-03**: Provider API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`) come from env; never logged, never echoed in errors
- [ ] **AUTH-04**: Payload size limit of 32KB enforced before body parsing (413 on oversize)

### Bot Persona Management

- [ ] **BOT-01**: `brain.bots` table stores `{ id, system_prompt, preferred_provider (nullable), preferred_model (nullable), langfuse_prompt_id (nullable, reserved for v1.x migration), created_at, updated_at, deleted_at }`
- [ ] **BOT-02**: `POST /v1/bots` creates a bot with id + system_prompt; returns 201 with full bot record
- [ ] **BOT-03**: `GET /v1/bots/{id}` returns a bot record (404 if missing, 410 if soft-deleted)
- [ ] **BOT-04**: `PUT /v1/bots/{id}` updates a bot (writes new row version, never destroys history)
- [ ] **BOT-05**: `DELETE /v1/bots/{id}` soft-deletes a bot (sets `deleted_at`); existing sessions can still resolve persona
- [ ] **BOT-06**: `brain.bot_audit_log` append-only table records every create/update/delete with actor + timestamp + diff
- [ ] **BOT-07**: `system_prompt` length is capped (DB CHECK constraint, configurable via env, default 32KB)
- [ ] **BOT-08**: Persona lookups are cached in-process with ~60s TTL to avoid hot-path DB hits
- [ ] **BOT-09**: A given conversation turn uses the persona snapshot loaded at turn-start, even if persona is edited mid-turn

### Webhook Ingress

- [ ] **WEB-01**: `POST /v1/webhook` accepts `{ botId, sessionId, conteudo, schema_version, idempotency_key? }` JSON body
- [ ] **WEB-02**: Pydantic validates payload shape; returns 422 with field-level errors on malformed input
- [ ] **WEB-03**: Unknown `botId` returns 404 with structured error envelope (no LLM call attempted)
- [ ] **WEB-04**: Error responses follow a stable envelope: `{ error: { code, message, traceId } }` with documented codes
- [ ] **WEB-05**: OpenAPI docs are exposed at `/docs` (Swagger UI) for integrator discovery

### RabbitMQ Ingress

- [ ] **MQ-01**: Worker connects via `aio-pika.connect_robust` (auto-reconnect on broker restart)
- [ ] **MQ-02**: Topology declared by a dedicated init container `brain-topology-init`; runtime consumers declare queues `passive=True`
- [ ] **MQ-03**: `brain.in` queue is declared with `x-dead-letter-exchange=brain.dlx` routing to `brain.dlq`
- [ ] **MQ-04**: Consumer uses **manual ack only** with `prefetch_count=1`
- [ ] **MQ-05**: `nack(requeue=False)` is used on unrecoverable errors (4xx-equivalent); transient errors raise and let RabbitMQ retry
- [ ] **MQ-06**: Per-LLM `httpx` timeout is configured to be lower than RabbitMQ consumer delivery timeout (no silent message redelivery)
- [ ] **MQ-07**: Response message published to `brain.out` round-trips the original `correlation_id` and `reply_to` properties
- [ ] **MQ-08**: Publisher confirms enabled on `brain.out` (no silent message loss)
- [ ] **MQ-09**: AsyncAPI document published for `brain.in` / `brain.out` payload schemas

### Idempotency

- [ ] **IDEMP-01**: Both ingresses honor an `idempotency_key` (header for HTTP, AMQP property for queue); same key within TTL returns the cached response without re-executing the graph
- [ ] **IDEMP-02**: Idempotency cache lives in Postgres (`brain.idempotency` table) with TTL ~24h, cleaned by a daily background task
- [ ] **IDEMP-03**: If a key is seen but the original request is still in-flight, the second request waits (or returns 409 with retry hint) — no double-processing

### LangGraph Orchestration

- [ ] **GRAPH-01**: Graph topology: `load_persona → (fetch_short_term ∥ fetch_long_term) → build_messages → call_llm → persist_message → embed_and_store → build_response`
- [ ] **GRAPH-02**: `AsyncPostgresSaver` is the checkpointer; `thread_id = thread_id(bot_id, session_id)` keys every run
- [ ] **GRAPH-03**: An in-process `asyncio.Lock` registry keyed by `f"{bot_id}:{session_id}"` serializes turns on the same session
- [ ] **GRAPH-04**: Effect nodes (`persist_message`, `embed_and_store`) use idempotency keys (`sha256(bot_id|session_id|content)`) + upsert / `ON CONFLICT DO NOTHING` so checkpoint replay is safe
- [ ] **GRAPH-05**: The `node_trace` (list of executed nodes with timings) is included in every response
- [ ] **GRAPH-06**: Graph recursion limit is configured explicitly; exceeded recursion produces a typed error, not a silent failure

### LLM Providers

- [ ] **LLM-01**: `LLMProvider` protocol exposes `agenerate(messages, model, **kwargs) -> ProviderResult` with a stable return shape across providers
- [ ] **LLM-02**: `OpenAIProvider` adapter wraps `langchain-openai` (GPT-4.1 default)
- [ ] **LLM-03**: `GeminiProvider` adapter wraps `langchain-google-genai` (Gemini 2.5 Flash default)
- [ ] **LLM-04**: Default provider + model selected via `PROVIDER_DEFAULT` and `MODEL_DEFAULT` env vars
- [ ] **LLM-05**: On primary provider error/timeout, fallback provider is invoked via LangChain `Runnable.with_fallbacks(exceptions_to_handle=...)`
- [ ] **LLM-06**: `ProviderError` taxonomy categorizes errors as `TRANSIENT | RATE_LIMIT | BAD_INPUT | CONTENT_POLICY | AUTH`; only TRANSIENT and RATE_LIMIT trigger fallback
- [ ] **LLM-07**: `tenacity` retries with exponential backoff + jitter on TRANSIENT errors; `Retry-After` honored on RATE_LIMIT
- [ ] **LLM-08**: Per-provider timeout is configurable via env; partial responses on fallback are discarded (no token concatenation across providers)
- [ ] **LLM-09**: Per-provider token counter (`tiktoken` for OpenAI, `count_tokens` API for Gemini) reports usage; included in response metadata
- [ ] **LLM-10**: Bots can override default provider/model via `preferred_provider` / `preferred_model` columns (BOT-01); falls back to env defaults when null
- [ ] **LLM-11**: Adding a third provider in the future requires only one new file in `providers/` + one line in `providers/registry.py` (no graph changes)

### Short-Term Memory

- [ ] **STM-01**: `brain.messages` table stores `{ id, bot_id, session_id, role (user|assistant), content, model, token_usage, created_at }`
- [ ] **STM-02**: `ShortTermRepo.fetch_last_n(bot_id, session_id, n)` returns the last N messages ordered by `created_at` ASC; default N=10 (configurable via env `MEMORY_SHORT_TERM_LIMIT`)
- [ ] **STM-03**: `fetch_short_term_memory` graph node hydrates the message window into LangGraph state
- [ ] **STM-04**: `persist_message` graph node writes user message + assistant reply atomically (single transaction, idempotent on idempotency key)
- [ ] **STM-05**: Concurrent same-session requests are serialized end-to-end by GRAPH-03; integration test fires 5 concurrent turns and asserts strict ordering
- [ ] **STM-06**: Cross-session leak test: messages from session A on bot X never appear in any query against (bot X, session B) or (bot Y, session A)

### Long-Term Memory (Vector)

- [ ] **VEC-01**: Qdrant single collection `brain_memory` with payload index on `bot_id` and `session_id`; filterable HNSW
- [ ] **VEC-02**: `VectorStore` protocol abstracts Qdrant; `QdrantStore` is the v1 concrete implementation
- [ ] **VEC-03**: All vector queries pass `Filter(must=[bot_id, session_id])` — the wrapper raises if either is missing (lint rule + runtime check)
- [ ] **VEC-04**: Raw `qdrant_client` is only imported in `vectordb/`; usage elsewhere fails CI
- [ ] **VEC-05**: `fetch_long_term_memory` graph node runs in parallel with `fetch_short_term_memory` via `asyncio.gather`
- [ ] **VEC-06**: `embed_and_store` graph node embeds the user message and assistant reply, then upserts with id `sha256(bot_id|session_id|content)` (idempotent)
- [ ] **VEC-07**: Each vector record stores metadata: `bot_id, session_id, role, embedding_model_id, embedding_dim, created_at`
- [ ] **VEC-08**: Brain validates at startup that the existing Qdrant collection's dimension matches the active `EmbeddingProvider`'s `dimensions` constant; mismatch = fast fail with clear error

### Embeddings (Multi-Provider)

- [ ] **EMB-01**: `EmbeddingProvider` protocol mirrors `LLMProvider`: `aembed(texts) -> list[Vector]`; each adapter exposes its native `dimensions` as a class constant
- [ ] **EMB-02**: v1 ships two adapters: `OpenAIEmbedding` (text-embedding-3-small, **1536d fixed in code**) and `GeminiEmbedding` (gemini-embedding-001, **768d fixed in code** via Matryoshka truncation)
- [ ] **EMB-03**: Adapter selection via `EMBEDDING_PROVIDER` env (`openai` | `gemini`); model and dimension are NOT env-configurable — they live in the adapter
- [ ] **EMB-04**: Choice is treated as **install-time** (not runtime-switchable); changing provider or dimension requires editing the adapter, redeploying, and reindexing Qdrant — README documents this as a one-way door
- [ ] **EMB-05**: Adding a third embedding provider requires only one new file in `embeddings/` + one line in `embeddings/registry.py`

### Observability (Langfuse)

- [ ] **OBS-01**: Langfuse `CallbackHandler` is attached to every `graph.ainvoke` invocation
- [ ] **OBS-02**: A root span is opened per request in middleware (HTTP) / consumer (AMQP), with consistent tagging: `bot:{id}`, `session:{id}`, `provider`, `model`, `fallback_used`, `ingress:{http|amqp}`
- [ ] **OBS-03**: `traceId` (Langfuse trace ID) is populated in the response envelope
- [ ] **OBS-04**: Langfuse callbacks are fire-and-forget: failures swallowed, never break the request path
- [ ] **OBS-05**: A circuit breaker disables Langfuse export after N consecutive failures (configurable); auto-recovers after cooldown
- [ ] **OBS-06**: `Authorization` header and provider API keys are masked in Langfuse traces (mask callback); canary-token regression test included

### Response Envelope

- [ ] **RESP-01**: Success response shape: `{ sessionId, resposta, model, tokenUsage: { prompt, completion, total }, fallbackUsed, traceId, nodeTrace: [{ node, durationMs }] }`
- [ ] **RESP-02**: Webhook returns 200 with the envelope as body
- [ ] **RESP-03**: AMQP publishes the same envelope to `brain.out` with `correlation_id` round-tripped
- [ ] **RESP-04**: Error response shape: `{ error: { code, message, traceId } }` with documented codes

### Deployment (Docker Compose)

- [ ] **DEPLOY-01**: `docker-compose.yml` runs the full stack: Brain (api + worker), Postgres (brain), RabbitMQ, Qdrant, Langfuse-web, Langfuse-worker, Langfuse-Postgres, ClickHouse, Redis, MinIO
- [ ] **DEPLOY-02**: `docker-compose.lite.yml` runs the inner-loop dev subset: Brain + Postgres (brain) + RabbitMQ + Qdrant (no Langfuse subsystem)
- [ ] **DEPLOY-03**: Multi-stage `Dockerfile` produces `base → dev → prod` images; prod image is non-root, slim, with healthcheck
- [ ] **DEPLOY-04**: All services declare healthchecks; Brain `depends_on` uses `condition: service_healthy`
- [ ] **DEPLOY-05**: `brain-migrate` init container runs Alembic migrations against `brain.*` schema before Brain starts
- [ ] **DEPLOY-06**: `brain-topology-init` init container declares RabbitMQ exchanges/queues/DLX before workers start
- [ ] **DEPLOY-07**: `.env.example` documents every variable with default and description; `.env` itself is gitignored
- [ ] **DEPLOY-08**: README has copy-paste instructions to spin up the stack and send a first request via `curl`

## v2 Requirements

Deferred to a future milestone. Tracked but not in current roadmap.

### Streaming

- **V2-STR-01**: SSE endpoint for token-by-token responses on a dedicated route
- **V2-STR-02**: Streaming-aware tagging in Langfuse

### Multimodal

- **V2-MM-01**: Direct image ingest (no description workaround)
- **V2-MM-02**: Direct video ingest (frame extraction or native multimodal)
- **V2-MM-03**: Named-vector schema in Qdrant for `text`/`image`/`video` vectors in one collection

### Advanced Routing

- **V2-RTR-01**: Intent classification node to route requests to specialized models
- **V2-RTR-02**: Cost/complexity-aware model selection

### Cross-Session Memory

- **V2-MEM-01**: `userId` field with cross-session aggregation
- **V2-MEM-02**: Hierarchical memory: session-scoped recall + user-global recall

### Provider Expansion

- **V2-LLM-01**: Anthropic Claude adapter
- **V2-LLM-02**: Local LLM (Ollama) adapter
- **V2-LLM-03**: OpenRouter / aggregator adapter

### Prompt Management

- **V2-PROMPT-01**: Migrate persona prompts from Postgres to Langfuse Prompt CMS (use `langfuse_prompt_id` slot reserved in BOT-01)
- **V2-PROMPT-02**: Prompt versioning + rollback UI

### Hardening (post-launch)

- **V2-HARD-01**: PII redaction (LGPD) on Langfuse traces (Presidio or `mask`)
- **V2-HARD-02**: Per-bot rate limiting
- **V2-HARD-03**: Exact-match response cache
- **V2-HARD-04**: Bearer token rotation (`BRAIN_AUTH_TOKENS=tok1,tok2`)
- **V2-HARD-05**: Async embed-and-store (off hot path) if p95 latency demands it
- **V2-HARD-06**: Distributed per-session lock (Redis) for multi-replica Brain deploys
- **V2-HARD-07**: Memory summarization (collapse old turns when threads grow long)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Streaming responses (SSE/WebSocket) in v1 | Webhook + queue architecture is intrinsically batch; streaming complicates both paths without clear v1 value. Revisit in v2. |
| Direct image/video processing in v1 | Vector DB has multimodal headroom but processing pipeline (CLIP, frame extraction) is its own milestone. v1 accepts text *descriptions*. |
| Anthropic / Claude provider in v1 | OpenAI + Gemini covers the dual-provider story; adding more is mechanical once abstraction is proven. |
| Intent / complexity-based routing | Adds an extra classifier model on hot path. Default + fallback is sufficient for v1 reliability. |
| `userId` / cross-session memory | Significant complexity; not required by initial use case. Sessions are isolated by design in v1. |
| Local LLM providers (Ollama) | v1 is online-providers only per user requirement. |
| Per-end-user authentication | Brain is a backend service; auth is single Bearer between trusted adapters, not multi-user. |
| Chat UI / playground built into Brain | Integrators use `curl` + `/docs` + Langfuse trace replay. Not a user-facing product. |
| Supervisor / multi-agent / agent-of-agents patterns | One linear graph per request keeps complexity bounded; multi-agent adds failure modes without v1 value. |
| Custom prompt management UI in v1 | Langfuse Prompt CMS will fill this role in v1.x (V2-PROMPT-01); no need to build our own. |
| pgvector as the vector DB | Multimodal headroom is locked scope; pgvector path is a one-way door. Qdrant chosen explicitly. |
| Prompt-injection guardrails giving false confidence | Honest threat-model + targeted mitigations only; no "guardrails LLM" theater. |
| Semantic / similarity response cache in v1 | Cross-session leakage risk conflicts with session-isolation guarantee (STM-06, VEC-03). |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Pending |
| FOUND-06 | Phase 1 | Pending |
| FOUND-07 | Phase 1 | Pending |
| FOUND-08 | Phase 1 | Pending |
| FOUND-09 | Phase 1 | Pending |
| FOUND-10 | Phase 1 | Pending |
| FOUND-11 | Phase 1 | Pending |
| FOUND-12 | Phase 1 | Pending |
| AUTH-01 | Phase 3 | Pending |
| AUTH-02 | Phase 3 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| BOT-01 | Phase 2 | Pending |
| BOT-02 | Phase 2 | Pending |
| BOT-03 | Phase 2 | Pending |
| BOT-04 | Phase 2 | Pending |
| BOT-05 | Phase 2 | Pending |
| BOT-06 | Phase 2 | Pending |
| BOT-07 | Phase 2 | Pending |
| BOT-08 | Phase 2 | Pending |
| BOT-09 | Phase 2 | Pending |
| WEB-01 | Phase 3 | Pending |
| WEB-02 | Phase 3 | Pending |
| WEB-03 | Phase 3 | Pending |
| WEB-04 | Phase 3 | Pending |
| WEB-05 | Phase 3 | Pending |
| MQ-01 | Phase 8 | Pending |
| MQ-02 | Phase 8 | Pending |
| MQ-03 | Phase 8 | Pending |
| MQ-04 | Phase 8 | Pending |
| MQ-05 | Phase 8 | Pending |
| MQ-06 | Phase 8 | Pending |
| MQ-07 | Phase 8 | Pending |
| MQ-08 | Phase 8 | Pending |
| MQ-09 | Phase 8 | Pending |
| IDEMP-01 | Phase 8 | Pending |
| IDEMP-02 | Phase 8 | Pending |
| IDEMP-03 | Phase 8 | Pending |
| GRAPH-01 | Phase 6 | Pending |
| GRAPH-02 | Phase 6 | Pending |
| GRAPH-03 | Phase 6 | Pending |
| GRAPH-04 | Phase 6 | Pending |
| GRAPH-05 | Phase 3 | Pending |
| GRAPH-06 | Phase 3 | Pending |
| LLM-01 | Phase 5 | Pending |
| LLM-02 | Phase 5 | Pending |
| LLM-03 | Phase 5 | Pending |
| LLM-04 | Phase 5 | Pending |
| LLM-05 | Phase 5 | Pending |
| LLM-06 | Phase 5 | Pending |
| LLM-07 | Phase 5 | Pending |
| LLM-08 | Phase 5 | Pending |
| LLM-09 | Phase 5 | Pending |
| LLM-10 | Phase 5 | Pending |
| LLM-11 | Phase 5 | Pending |
| STM-01 | Phase 6 | Pending |
| STM-02 | Phase 6 | Pending |
| STM-03 | Phase 6 | Pending |
| STM-04 | Phase 6 | Pending |
| STM-05 | Phase 6 | Pending |
| STM-06 | Phase 6 | Pending |
| VEC-01 | Phase 7 | Pending |
| VEC-02 | Phase 7 | Pending |
| VEC-03 | Phase 7 | Pending |
| VEC-04 | Phase 7 | Pending |
| VEC-05 | Phase 7 | Pending |
| VEC-06 | Phase 7 | Pending |
| VEC-07 | Phase 7 | Pending |
| VEC-08 | Phase 7 | Pending |
| EMB-01 | Phase 7 | Pending |
| EMB-02 | Phase 7 | Pending |
| EMB-03 | Phase 7 | Pending |
| EMB-04 | Phase 7 | Pending |
| EMB-05 | Phase 7 | Pending |
| OBS-01 | Phase 4 | Pending |
| OBS-02 | Phase 4 | Pending |
| OBS-03 | Phase 4 | Pending |
| OBS-04 | Phase 4 | Pending |
| OBS-05 | Phase 4 | Pending |
| OBS-06 | Phase 4 | Pending |
| RESP-01 | Phase 3 | Pending |
| RESP-02 | Phase 3 | Pending |
| RESP-03 | Phase 8 | Pending |
| RESP-04 | Phase 3 | Pending |
| DEPLOY-01 | Phase 1 | Pending |
| DEPLOY-02 | Phase 1 | Pending |
| DEPLOY-03 | Phase 1 | Pending |
| DEPLOY-04 | Phase 1 | Pending |
| DEPLOY-05 | Phase 1 | Pending |
| DEPLOY-06 | Phase 1 | Pending |
| DEPLOY-07 | Phase 1 | Pending |
| DEPLOY-08 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 96 total (12 FOUND + 4 AUTH + 9 BOT + 5 WEB + 9 MQ + 3 IDEMP + 6 GRAPH + 11 LLM + 6 STM + 8 VEC + 5 EMB + 6 OBS + 4 RESP + 8 DEPLOY)
- Mapped to phases: 96 ✓
- Unmapped: 0 ✓

**Distribution by phase:**
- Phase 1 (Foundations & Compose Skeleton): 22 reqs
- Phase 2 (Bot Persona CRUD + Audit): 9 reqs
- Phase 3 (Minimal Webhook + Single-Node Graph): 12 reqs
- Phase 4 (Langfuse Wiring): 6 reqs
- Phase 5 (Multi-Provider + Fallback): 11 reqs
- Phase 6 (Short-Term Memory + Postgres Checkpointer): 10 reqs
- Phase 7 (Vector Memory): 13 reqs
- Phase 8 (RabbitMQ Ingress + Idempotency): 13 reqs
- Phase 9 (Hardening): 0 v1 reqs (operational hardening; v2-HARD items tracked separately)

---
*Requirements defined: 2026-05-21*
*Last updated: 2026-05-21 after roadmap traceability mapping*
