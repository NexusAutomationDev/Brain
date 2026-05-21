# Architecture Research

**Domain:** Centralized LangGraph-based AI orchestration service (Brain)
**Researched:** 2026-05-21
**Confidence:** HIGH (locked stack constrains the design space tightly; remaining choices verified against LangGraph + FastAPI + aio-pika current docs)

---

## System Overview

```
                          ┌──────────────────────────────┐
                          │     External Bot Adapters     │
                          │  (WhatsApp / Telegram / ...)  │
                          └──────────────┬───────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │                               │
                  HTTP (Bearer)                  AMQP (brain.in)
                         │                               │
                         ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          INGRESS LAYER                              │
│  ┌──────────────────────────┐      ┌──────────────────────────┐    │
│  │  api/  (FastAPI)         │      │  workers/ (aio-pika)     │    │
│  │   - auth middleware      │      │   - consumer loop        │    │
│  │   - schema validation    │      │   - schema validation    │    │
│  │   - rate limit (opt.)    │      │   - ack / nack / DLQ     │    │
│  └────────────┬─────────────┘      └────────────┬─────────────┘    │
│               │  both call  ──────────────────  │                  │
│               │  brain.service.handle_request(BrainRequest) ─→     │
└───────────────┼────────────────────────────────┼──────────────────┘
                │                                │
                ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION SERVICE                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  service/  (brain_service.py)                               │    │
│  │   - per-session asyncio.Lock registry                       │    │
│  │   - persona load (cache)                                    │    │
│  │   - LangGraph invocation with thread_id=(botId,sessionId)   │    │
│  │   - Langfuse trace context                                  │    │
│  │   - response builder                                        │    │
│  └─────────────────────────┬───────────────────────────────────┘    │
└────────────────────────────┼────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LANGGRAPH ORCHESTRATION                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  graph/  (StateGraph + nodes/ + edges)                      │    │
│  │   load_persona → fetch_short_term → fetch_long_term →       │    │
│  │   build_messages → call_llm (router+fallback) →             │    │
│  │   persist_message → embed_and_store → build_response        │    │
│  └──┬────────────┬─────────────┬──────────────┬─────────┬──────┘    │
│     │            │             │              │         │           │
└─────┼────────────┼─────────────┼──────────────┼─────────┼───────────┘
      ▼            ▼             ▼              ▼         ▼
┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌─────────┐ ┌──────────┐
│ providers│ │  memory  │ │  personas   │ │  db/    │ │ vectordb │
│  /       │ │  /       │ │  /          │ │ (asyncpg│ │  /       │
│ openai + │ │ short +  │ │ Postgres    │ │ + alembic│ │ Qdrant / │
│ gemini   │ │ long     │ │ CRUD repo   │ │ + checkpt│ │ pgvector │
│ adapters │ │ readers  │ │             │ │ saver)   │ │ adapter  │
└──────────┘ └──────────┘ └─────────────┘ └─────────┘ └──────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CROSS-CUTTING                                 │
│  observability/ (Langfuse handler)  •  config/ (Pydantic Settings)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Module | Responsibility | Talks To | Key Abstraction Seam |
|--------|----------------|----------|----------------------|
| `api/` | FastAPI app, `/v1/webhook` route, Bearer auth middleware, Pydantic request/response schemas, health/readiness endpoints, bot CRUD endpoints | `service/`, `personas/` | HTTP boundary only — no domain logic |
| `workers/` | aio-pika `connect_robust` consumer on `brain.in`, dispatches to `service/`, publishes reply to `brain.out`, DLQ on failure | `service/`, RabbitMQ | Queue boundary only — symmetric with `api/` |
| `service/` | `BrainService.handle_request()` — single entry point both ingresses call. Owns per-session locking, persona loading, Langfuse span root, LangGraph invocation, response assembly | `graph/`, `personas/`, `observability/` | The shared waist — every request funnels through here |
| `graph/` | `build_graph()` returns a compiled `StateGraph`. One file per node in `graph/nodes/`. `graph/state.py` defines `BrainState` (TypedDict). `graph/edges.py` holds conditional edge functions | `providers/`, `memory/`, `personas/`, `db/`, `vectordb/` | Nodes import services through small interfaces — never reach into module internals |
| `providers/` | `LLMProvider` abstract base; `OpenAIProvider`, `GeminiProvider` concrete; `ProviderRouter` that wraps default+fallback. Each provider returns a normalized `LLMResponse(content, model, prompt_tokens, completion_tokens)` | OpenAI SDK, Google GenAI SDK | **Abstract base class** — add a third provider by dropping a new file and registering it in `providers/registry.py` |
| `memory/` | `ShortTermRepo` (last-N from Postgres history table), `LongTermRepo` (semantic search via `vectordb/`), `EmbeddingClient` (wraps embedding model, today OpenAI `text-embedding-3-small`) | `db/`, `vectordb/`, providers | Repos are plain async classes; nodes depend on the interface |
| `personas/` | `PersonaRepo` — CRUD over `bots` table, in-process TTL cache (~60s) keyed by `botId`. Persona = `{id, name, system_prompt, default_model?, metadata}` | `db/` | Cache wrapper sits in front of repo |
| `observability/` | Langfuse client init, FastAPI middleware that opens root trace, helper to bind trace context to LangGraph callback handler | Langfuse SDK | Single `LangfuseCallbackHandler` injected into every graph run |
| `config/` | `Settings(BaseSettings)` from pydantic-settings. One object, validated at startup, injected via FastAPI `Depends` and worker constructor | All modules | All env access flows through `get_settings()` — no `os.getenv` scattered |
| `db/` | asyncpg connection pool, SQLAlchemy 2.x async models for `bots`, `messages`, `sessions` (optional). Alembic migrations. Houses the `AsyncPostgresSaver` instance | Postgres | Repos own queries; nothing else touches the pool directly |
| `vectordb/` | `VectorStore` protocol with `upsert(namespace, id, vector, payload)`, `search(namespace, vector, k, filter)`. Concrete `QdrantStore` (recommended) or `PgVectorStore`. Namespace convention: `bot_{botId}` with `sessionId` in the filter | Vector DB driver | **Protocol** — swap by changing one config + one factory |

### Abstraction seams (where extension lives)

1. **New LLM provider** = new file under `providers/` + one line in `providers/registry.py`. No graph changes.
2. **Swap vector DB** = new file under `vectordb/`, change `VECTOR_DB_BACKEND` env var. No memory or graph changes.
3. **New ingress (e.g., gRPC)** = new sibling to `api/` and `workers/` calling `BrainService.handle_request`. Graph untouched.
4. **New graph node** = new file in `graph/nodes/`, register in `build_graph()`. Doesn't touch ingress.

---

## LangGraph Node Topology

### State schema (`graph/state.py`)

```python
class BrainState(TypedDict):
    # Inputs (set by service layer before invoke)
    bot_id: str
    session_id: str
    user_content: str
    persona: PersonaRecord            # pre-loaded by service

    # Memory (populated by fetch nodes)
    short_term: list[ChatMessage]     # last N from Postgres
    long_term: list[SemanticHit]      # top-k from vector DB

    # LLM prep / output
    messages: list[ChatMessage]       # built prompt
    llm_response: LLMResponse | None  # content, model, tokens
    provider_attempts: list[ProviderAttempt]  # for trace

    # Bookkeeping
    error: str | None
    node_trace: list[str]             # appended by each node for response.trace
```

### Nodes — validated topology

The suggested set is correct. One revision: **promote provider routing from "node logic" to a small router *inside* `call_llm`**, and only use a *conditional edge* for unrecoverable errors. Reason: LangChain's `Runnable.with_fallbacks()` is the lowest-friction path and keeps the graph linear; the conditional edge handles the catastrophic "both providers failed" case.

| # | Node | Reads from state | Writes to state | Side effects |
|---|------|------------------|-----------------|--------------|
| 1 | `load_persona` | `bot_id` | `persona` | Skipped if service pre-loads (recommended); kept as safety net + cache-miss path |
| 2 | `fetch_short_term_memory` | `bot_id`, `session_id` | `short_term` | SELECT last N from `messages` WHERE bot_id, session_id |
| 3 | `fetch_long_term_memory` | `bot_id`, `session_id`, `user_content` | `long_term` | Embed query → vector search filtered by `bot_id, session_id` |
| 4 | `build_messages` | `persona`, `short_term`, `long_term`, `user_content` | `messages` | Pure — assemble system + recall + history + user |
| 5 | `call_llm` | `messages` | `llm_response`, `provider_attempts` | Provider router invokes default model; falls back via `with_fallbacks` on exception/timeout; records each attempt |
| 6 | `persist_message` | `bot_id`, `session_id`, `user_content`, `llm_response` | — | INSERT user msg + assistant msg into `messages` |
| 7 | `embed_and_store` | `user_content`, `llm_response` | — | Embed both, upsert into vector DB with `bot_id`, `session_id`, `role`, `created_at` payload |
| 8 | `build_response` | everything | — | Pure — service reads final state to assemble outbound payload |

### Edges

```
START
  → load_persona              (skip via short-circuit if state.persona is set)
  → fetch_short_term_memory   ┐
  → fetch_long_term_memory    │  (could be parallelized; see below)
  → build_messages
  → call_llm
       ├─ conditional: provider_attempts all failed → END (error path)
       └─ otherwise               ↓
  → persist_message
  → embed_and_store
  → build_response
  → END
```

**Conditional edges live in two places:**

1. **After `call_llm`** — `route_after_llm(state)`: if `llm_response is None`, jump to `build_response` (which returns the error) and skip persistence/embedding. Otherwise continue.
2. **Within `call_llm`** — provider fallback is *not* a graph edge; it's `default_provider.with_fallbacks([secondary_provider])` inside the node. This keeps the graph readable and gives Langfuse a single span for "LLM call" with nested attempt spans.

### Parallelization opportunity

`fetch_short_term_memory` and `fetch_long_term_memory` are independent reads. LangGraph supports parallel edges by branching from a common predecessor. **Recommendation:** start serial (simpler, easier to debug), parallelize in a later phase if latency budget demands it. Postgres latency is typically <5ms; vector search (with embedding call) is the long tail.

---

## Provider Abstraction

### Interface

```python
class LLMProvider(Protocol):
    name: str                              # "openai", "gemini"
    default_model: str

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        timeout: float = 30.0,
    ) -> LLMResponse: ...
```

`LLMResponse` is the normalized return: `content: str`, `model: str`, `prompt_tokens: int`, `completion_tokens: int`, `provider: str`, `raw: dict` (for trace).

### Router and fallback

Two viable implementations — **recommendation: use LangChain's `with_fallbacks`** because Langfuse instruments it natively and the trace shows attempts as nested spans.

```python
# providers/router.py
def build_chat_model(settings: Settings) -> Runnable:
    primary = _build(settings.provider_default)      # e.g., ChatOpenAI(model=...)
    fallback = _build(settings.provider_fallback)    # e.g., ChatGoogleGenerativeAI(model=...)
    return primary.with_fallbacks(
        [fallback],
        exceptions_to_handle=(RateLimitError, APIError, asyncio.TimeoutError, ...),
    )
```

The `call_llm` node simply invokes this composed Runnable. The Langfuse `CallbackHandler` is attached at graph invoke time (`config={"callbacks": [langfuse_handler]}`), and it captures both the parent LLM call and any fallback attempt because `with_fallbacks` produces nested run events.

**Why not a custom router node?** A custom try/except chain is fine, but you lose the auto-traced nesting and have to re-implement retry/timeout. Use `with_fallbacks` for the common path; only build a custom router if you later need intent-based routing (explicitly out of scope for v1).

**Adding a third provider:**
1. Add `providers/anthropic.py` implementing the protocol.
2. Register in `providers/registry.py`: `REGISTRY = {"openai": ..., "gemini": ..., "anthropic": ...}`.
3. Set `PROVIDER_FALLBACK=anthropic` (or chain multiple).
Zero changes elsewhere.

### Langfuse instrumentation

- Root span = HTTP request (or queue message) — opened in middleware / worker dispatch.
- Child span = graph run — auto-created by `LangfuseCallbackHandler` passed to `graph.ainvoke(..., config={"callbacks": [handler]})`.
- Grandchild spans = each node + each LLM call (incl. fallback attempts) — auto-captured.
- `metadata={"bot_id": ..., "session_id": ...}` and `user_id=session_id` so Langfuse can group traces per session.

---

## Two Ingress, One Graph

The clean shared path:

```
[HTTP request]                  [RabbitMQ message]
      │                                  │
      ▼                                  ▼
api/routes/webhook.py            workers/consumer.py
  - Bearer auth dep                - aio-pika consumer
  - Pydantic BrainRequest          - JSON → Pydantic BrainRequest
  - call service                   - call service
      │                                  │
      └──────────────┬───────────────────┘
                     ▼
       service.brain_service.handle_request(req: BrainRequest)
                     │
                     ▼
            returns BrainResponse
                     │
       ┌─────────────┴──────────────┐
       ▼                            ▼
  HTTP 200 JSON          publish to brain.out
```

### Where cross-cutting concerns live

| Concern | Lives in | Why |
|---------|----------|-----|
| Bearer auth | `api/middleware/auth.py` (FastAPI dependency) | HTTP-only; queue ingress is trusted via network isolation on the Docker network |
| Payload schema validation | `api/schemas.py` (Pydantic models) — *imported by* `workers/consumer.py` too | Same Pydantic model parses HTTP body and AMQP body. One source of truth. |
| Rate limiting | `api/middleware/ratelimit.py` (slowapi or custom Redis counter) | HTTP-only in v1. Queue is naturally rate-limited by consumer prefetch. **Defer to a later phase** — locked decisions don't require it. |
| Idempotency (optional) | `service/` — keyed by `(botId, sessionId, content_hash)` or message-id | Shared by both ingresses |
| Langfuse trace root | `service/` | Both ingresses produce the same trace shape |

**Symmetry rule:** anything past `service.handle_request` knows nothing about how the request arrived.

---

## Data Flow — Canonical Request Trace

Request: `POST /v1/webhook` with `{ botId: "wa-vendas", sessionId: "5511...", conteudo: "qual o preço?" }`.

```
T+0ms    [api/middleware/auth]   Verify Bearer == WEBHOOK_AUTH_TOKEN  → ok
T+1ms    [api/routes/webhook]    Pydantic parse → BrainRequest
T+1ms    [observability]         Open Langfuse root trace, bind to ctx
T+2ms    [service]               Acquire asyncio.Lock for (botId, sessionId)
T+2ms    [personas]              PersonaRepo.get("wa-vendas")
                                   ↳ cache hit? return.
                                   ↳ miss? SELECT FROM bots WHERE id=...
T+5ms    [service]               graph.ainvoke(initial_state,
                                    config={
                                      "configurable": {"thread_id": "wa-vendas:5511..."},
                                      "callbacks": [langfuse_handler],
                                    })
                                 LangGraph loads checkpoint via AsyncPostgresSaver
T+10ms   [node: load_persona]    No-op (persona pre-set)
T+12ms   [node: fetch_short_term]SELECT last 10 FROM messages
                                   WHERE bot_id='wa-vendas' AND session_id='5511...'
                                   ORDER BY created_at DESC LIMIT 10
T+20ms   [node: fetch_long_term] embed(user_content)  ← provider call (~80-200ms)
T+200ms                          vectordb.search(ns='bot_wa-vendas', filter={session_id},
                                                 k=5) ← ~10-30ms
T+220ms  [node: build_messages]  Compose [system_prompt, *recall_summary,
                                          *short_term, user_msg]
T+221ms  [node: call_llm]        chat_model.ainvoke(messages)
                                   ↳ OpenAI returns in ~800-2000ms
                                   ↳ on TimeoutError: with_fallbacks→Gemini
T+1500ms [node: persist_message] INSERT INTO messages (user_row, assistant_row)
T+1510ms [node: embed_and_store] embed(user_content), embed(assistant_content)
                                   ↳ 2x ~80-200ms (often batched, ~150ms)
T+1660ms                         vectordb.upsert(2 records)
T+1680ms [node: build_response]  No-op (service reads final state)
T+1681ms [service]               Release session lock
T+1682ms [service]               LangGraph checkpoint flushed by saver
T+1683ms [api]                   Return { sessionId, resposta, trace, metadata }
```

### Bottlenecks identified

| Stage | Typical | Hot-path? | Mitigation |
|-------|---------|-----------|------------|
| Embed for query | 80–200ms | Yes | Use cheap small model (e.g., `text-embedding-3-small`). Cache by content hash for repeat queries. |
| Vector search | 10–30ms | Yes | Qdrant or pgvector with HNSW; well within budget. |
| LLM call | 800–3000ms | Yes (unavoidable) | Set timeout = 25s; rely on fallback for latency outliers, not just errors. |
| Embed for storage (×2) | ~150ms | **Currently yes — this is the avoidable one** | **Move `embed_and_store` off the hot path**: write to Postgres synchronously, then enqueue an embedding job (or use `asyncio.create_task` after response is built but before connection close). Document trade-off: brief window where new turn isn't yet searchable. |
| Persona DB hit | <5ms | No (cached) | TTL cache in-process. |
| Checkpoint write | 5–20ms | Yes | Use connection pool; tolerate. |

**Recommendation:** for v1, keep `embed_and_store` on the hot path (simpler, correct). Add an "async write" mode in a follow-up phase if p95 latency exceeds budget.

---

## Concurrency Model

### Async everywhere

- FastAPI app — async route handlers.
- `asyncpg` for direct queries; SQLAlchemy 2.x async session for ORM-style.
- `aio-pika` (`connect_robust`, async consumers).
- LangGraph `ainvoke` with `AsyncPostgresSaver`.
- Provider SDKs: `openai>=1.0` (native async), `google-genai` (native async).

### Worker / process model

- **Single ASGI app** runs both the HTTP server and the RabbitMQ consumer as concurrent tasks. Use a FastAPI `lifespan` context manager to start/stop the consumer alongside the app.
- Run with **uvicorn (1 worker per container)**, scale by replicating the container. Avoid multi-worker uvicorn because LangGraph in-memory caches (persona cache, lock registry) won't be shared.
- Alternative: separate `api` and `worker` containers from the same image with different entrypoints. **Recommended for prod**, single-process for dev. Both call the same `BrainService`.

### RabbitMQ consumer settings

- `prefetch_count = 10` per consumer (start small; raise after observing).
- `connect_robust` for auto-reconnect.
- `requeue=False` on permanent failures → dead-letter to `brain.dlq`.
- Reply published to `brain.out` with `correlation_id` from the inbound message.

### Per-session locking

**Necessary.** Two reasons:

1. **AsyncPostgresSaver has an instance-level `threading.Lock`** ([github issue #7259](https://github.com/langchain-ai/langgraph/issues/7259)) — concurrent `ainvoke` on the same checkpointer instance serializes internally anyway, but only at the checkpoint write boundary, not at the level of "fetch state → mutate → persist." Two concurrent runs on the same `thread_id` can still interleave reads and produce a lost-update on the checkpoint.
2. **Memory clobbering** — two near-simultaneous messages from the same session could both read the same "last 10" and both append, producing out-of-order history.

**Implementation:** `service/locks.py` — a `SessionLockRegistry` holding `dict[str, asyncio.Lock]` keyed by `f"{bot_id}:{session_id}"`. Acquire before `graph.ainvoke`, release in `finally`. Per-process only; if scaled to multiple containers, add a Redis-based distributed lock (defer to scaling phase). Document this clearly: **same session → serialized; different sessions → fully parallel**.

### Connection pool sizing

- Postgres: `asyncpg.Pool(min_size=5, max_size=20)`. With AsyncPostgresSaver's internal lock, oversizing the pool past ~20 yields diminishing returns.
- HTTP clients (OpenAI/Gemini SDKs): default async clients are fine; rely on SDK-level pooling.
- Vector DB: one shared async client.

---

## Build Order

The suggested order is good. Minor revisions: pull Langfuse forward (it's trivial once you have a graph, and traces save you hours debugging), and split RabbitMQ into "scaffold" and "wire up" steps so the queue doesn't gate earlier value.

| Phase | Deliverable | Depends on | Why this order |
|-------|-------------|------------|----------------|
| **0. Skeleton** | FastAPI app, health endpoint, Pydantic settings, Postgres pool, Alembic init, Docker Compose with Postgres + (chosen vector DB) + RabbitMQ + Langfuse | — | Walking skeleton. Everything else builds on this. |
| **1. Bot CRUD** | `personas/` repo, `bots` table, `POST/GET/PUT/DELETE /v1/bots` | Phase 0 | Personas needed before graph; isolatable + testable without LLM. |
| **2. Minimal graph** | Single-node graph (`call_llm` only, OpenAI hardcoded), `/v1/webhook` route with Bearer auth, no memory | Phase 1 | Prove end-to-end request path. **First "it works" moment.** |
| **3. Langfuse wiring** | Callback handler attached, root trace from middleware, env-driven host | Phase 2 | Cheap to add now; pays back immediately during memory + provider work. |
| **4. Multi-provider + fallback** | `providers/` module, Gemini adapter, `with_fallbacks` composition, env-driven default+fallback | Phase 2 | Locks in the abstraction *before* memory complexity layers on. |
| **5. Short-term memory** | `messages` table, `ShortTermRepo`, `fetch_short_term_memory` + `persist_message` nodes, session lock registry | Phase 4 | Independent of vector DB; immediate UX win. Locking introduced here because memory is the first thing that races. |
| **6. LangGraph Postgres checkpointer** | `AsyncPostgresSaver` wired in, `thread_id` = `bot:session` | Phase 5 | Could go earlier but pays off most once there's history to checkpoint. |
| **7. Vector memory** | `vectordb/` adapter, embedding client, `fetch_long_term_memory` + `embed_and_store` nodes | Phase 5 | Requires schema + short-term plumbing to be stable. |
| **8. RabbitMQ ingress** | `workers/consumer.py`, `brain.in`/`brain.out` declarations, lifespan integration, DLQ | Phase 5 (post short-term) | Validates the "two ingress, one service" symmetry. Doing it after the HTTP path is fully working means you only have one new variable. |
| **9. Docker Compose hardening** | All services, healthchecks, volumes, `.env.example`, single-command up | All | Final integration pass. |
| **10. Polish** | Rate limit (if needed), idempotency, observability dashboards, runbook | All | Production-readiness items. |

**Rationale highlights:**
- Phase 2 (minimal graph) before multi-provider — you want to see a request flow end-to-end before adding routing complexity.
- Langfuse before memory — debugging memory issues without traces is painful.
- Multi-provider before memory — provider abstraction is independent of memory and easier to test in isolation.
- Checkpointer after short-term memory because checkpointer's value is most visible with state to recover.
- RabbitMQ last among ingresses because it's the only piece where "is the bug in my code or in the queue?" can dominate debugging time.

---

## Configuration Schema

Single `pydantic-settings` `Settings` class. All fields documented. All loaded from `.env` and overridable in tests.

```bash
# ──────────────── Service ────────────────
APP_ENV=development                       # development | production
APP_LOG_LEVEL=INFO
APP_HOST=0.0.0.0
APP_PORT=8000

# ──────────────── Auth ────────────────
WEBHOOK_AUTH_TOKEN=replace-me-with-a-long-random-string

# ──────────────── Postgres ────────────────
POSTGRES_URL=postgresql+asyncpg://brain:brain@postgres:5432/brain
POSTGRES_POOL_MIN=5
POSTGRES_POOL_MAX=20

# ──────────────── LangGraph ────────────────
LANGGRAPH_CHECKPOINTER=postgres           # postgres | memory (for tests)

# ──────────────── LLM Providers ────────────────
PROVIDER_DEFAULT=openai                   # openai | gemini
PROVIDER_FALLBACK=gemini                  # openai | gemini | none
PROVIDER_TIMEOUT_SECONDS=25

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
OPENAI_BASE_URL=                          # optional override

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash

# ──────────────── Embeddings ────────────────
EMBEDDING_PROVIDER=openai                 # openai | gemini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# ──────────────── Vector DB ────────────────
VECTOR_DB_BACKEND=qdrant                  # qdrant | pgvector
VECTOR_DB_URL=http://qdrant:6333
VECTOR_DB_API_KEY=                        # if applicable
VECTOR_DB_COLLECTION_PREFIX=bot_          # per-bot namespacing

# ──────────────── Memory ────────────────
MEMORY_SHORT_TERM_LIMIT=10
MEMORY_LONG_TERM_K=5                      # top-k semantic recall
MEMORY_LONG_TERM_MIN_SCORE=0.70           # similarity threshold

# ──────────────── RabbitMQ ────────────────
RABBITMQ_URL=amqp://brain:brain@rabbitmq:5672/
RABBITMQ_QUEUE_IN=brain.in
RABBITMQ_QUEUE_OUT=brain.out
RABBITMQ_QUEUE_DLQ=brain.dlq
RABBITMQ_PREFETCH=10
RABBITMQ_CONSUMER_ENABLED=true            # disable for HTTP-only deployments

# ──────────────── Langfuse ────────────────
LANGFUSE_HOST=http://langfuse:3000
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_ENABLED=true

# ──────────────── Persona Cache ────────────────
PERSONA_CACHE_TTL_SECONDS=60
```

**Conventions:**
- Group prefix per concern (`POSTGRES_*`, `RABBITMQ_*`, `PROVIDER_*`).
- Booleans as lowercase `true`/`false`.
- `*_URL` always includes scheme.
- `*_ENABLED` flags allow disabling a subsystem in dev/test.
- Secrets never have defaults; non-secrets do.

---

## Architectural Patterns

### Pattern 1: Shared service waist
**What:** Both ingresses (HTTP, AMQP) call one `BrainService.handle_request(req)` that returns a response. Ingresses are translation layers only.
**When:** Always — this is the load-bearing design choice for the two-ingress requirement.
**Trade-offs:** Slight indirection vs. massive de-duplication and consistency of behavior across protocols.

### Pattern 2: Provider router via `with_fallbacks`
**What:** LLM call site composes `primary.with_fallbacks([secondary])` once at startup; nodes are agnostic.
**When:** v1 default+fallback. Replace with custom router only if intent-based routing arrives.
**Trade-offs:** Limited to exception-driven fallback (no quality-based). Native Langfuse tracing makes this the lowest-friction option.

### Pattern 3: Per-session async lock keyed by `(botId, sessionId)`
**What:** In-process `dict[str, asyncio.Lock]` registry; acquire before graph invoke.
**When:** Always in v1. Upgrade to Redis-based distributed lock when scaling past one container per session-pool.
**Trade-offs:** Same-session messages serialize (correct behavior). Single-process scope is a known limitation, explicitly documented.

### Pattern 4: TypedDict graph state with explicit "trace" field
**What:** Every node appends its name to `state.node_trace`. Response embeds it.
**When:** Always — requirement is "in-response trace of LangGraph node execution."
**Trade-offs:** Tiny payload overhead; massive debug payoff.

### Pattern 5: Repository pattern for personas, memory, vector
**What:** All DB and vector access goes through `*Repo` classes with explicit async methods. Nodes depend on repos, not on drivers.
**When:** Always — makes nodes unit-testable with mocks.
**Trade-offs:** Boilerplate vs. testability. Worth it.

---

## Anti-Patterns

### Anti-Pattern 1: Doing provider routing as a separate graph node
**What people do:** Add a `route_provider` node that picks a provider, then `call_openai` and `call_gemini` nodes with conditional edges.
**Why it's wrong:** Triples node count, makes Langfuse traces messy, duplicates message-building logic, and `with_fallbacks` already does this with one line.
**Do this instead:** Keep one `call_llm` node; do composition in `providers/router.py`.

### Anti-Pattern 2: Letting nodes import drivers directly
**What people do:** `fetch_long_term_memory` calls `qdrant_client.search()` directly.
**Why it's wrong:** Locks the graph to one vector DB; can't swap without editing nodes.
**Do this instead:** Nodes call `LongTermRepo.recall(...)`; repo calls `VectorStore` protocol; concrete store chosen by config.

### Anti-Pattern 3: Per-request connection creation
**What people do:** `await asyncpg.connect(...)` inside handlers.
**Why it's wrong:** Postgres `max_connections=100` exhausts immediately under load; ditto vector DB, ditto AMQP.
**Do this instead:** One pool per resource, created at app startup (FastAPI `lifespan`), shared everywhere via DI.

### Anti-Pattern 4: Mixing sync and async drivers
**What people do:** Use `pika` (sync) alongside `asyncpg` (async).
**Why it's wrong:** Blocks the event loop, gutting concurrency.
**Do this instead:** `aio-pika` for AMQP, `asyncpg` for Postgres, async clients for everything.

### Anti-Pattern 5: Storing the system prompt in env
**What people do:** `BOT_SYSTEM_PROMPT=...` per bot.
**Why it's wrong:** New bot = redeploy. Defeats the entire CRUD-API requirement.
**Do this instead:** Personas in the `bots` table; CRUD endpoints; cache in-process with TTL.

### Anti-Pattern 6: Not locking same-session concurrent requests
**What people do:** Trust the checkpointer or "it'll be fine."
**Why it's wrong:** AsyncPostgresSaver's internal lock protects writes, not the read-mutate-write logical transaction. Concurrent same-session calls produce interleaved memory.
**Do this instead:** Per-session asyncio.Lock; document the constraint.

---

## Integration Points

### External services

| Service | Pattern | Notes |
|---------|---------|-------|
| OpenAI API | HTTPS, async SDK, retries via SDK, timeout 25s | Wrap in provider adapter; never call directly from nodes |
| Google Gemini API | HTTPS, async SDK | Same provider adapter pattern |
| Langfuse (self-hosted) | HTTPS POST, async callback handler | One handler per graph invoke; metadata-tagged |
| Postgres | TCP, async pool (asyncpg) | Single pool, shared by checkpointer + repos |
| RabbitMQ | AMQP, aio-pika `connect_robust` | One connection, multiple channels |
| Qdrant or pgvector | HTTP/grpc or SQL | Behind `VectorStore` protocol |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `api/` ↔ `service/` | Direct async call | Pydantic at the seam |
| `workers/` ↔ `service/` | Direct async call | Same Pydantic models |
| `service/` ↔ `graph/` | `graph.ainvoke(state, config)` | State is a TypedDict |
| Graph nodes ↔ repos | Direct async calls on repo instances | Repos passed via `state` or closure-injected at graph build |
| Repos ↔ drivers | Driver clients owned by repos | App lifespan owns the clients |

---

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 1 bot, dev | Single container; sqlite-checkpointer optional for tests; in-process everything. |
| 1–10 bots, ~50 RPS | Single container, 1 uvicorn worker, AsyncPostgresSaver, Qdrant single node. |
| 10–100 bots, ~500 RPS | Split `api` and `worker` containers from same image; scale `worker` horizontally; Postgres connection pool tuning; vector DB on dedicated node. |
| 100+ bots, 1k+ RPS | Distributed session lock (Redis); read replica for persona reads; embedding cache layer; async embedding pipeline; Langfuse sampling. |

### Scaling priorities

1. **First bottleneck: LLM latency dominates p95.** Mitigation: tighten timeouts, fallback faster, cache prompts where possible. Not a code change.
2. **Second bottleneck: embedding calls on hot path.** Move `embed_and_store` to a background task (`asyncio.create_task` after response built) or a separate worker reading from `brain.embed.in`.
3. **Third bottleneck: AsyncPostgresSaver internal lock.** Mitigation: shard by container (route bot→container), or wait for upstream fix tracked in [github issue #7259](https://github.com/langchain-ai/langgraph/issues/7259).
4. **Fourth bottleneck: per-process session lock registry.** Mitigation: Redis-based distributed lock when running >1 container behind a non-sticky load balancer.

---

## Sources

- [LangGraph Persistence — official docs](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [AsyncPostgresSaver reference](https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver)
- [langgraph-checkpoint-postgres on PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/)
- [LangChain RunnableWithFallbacks reference](https://python.langchain.com/api_reference/core/runnables/langchain_core.runnables.fallbacks.RunnableWithFallbacks.html)
- [LangGraph error handling: retries & fallback strategies](https://machinelearningplus.com/gen-ai/langgraph-error-handling-retries-fallback-strategies/)
- [LangChain fallbacks guide](https://python.langchain.com/v0.1/docs/guides/productionization/fallbacks/)
- [GitHub issue #7259 — AsyncPostgresSaver instance-level threading.Lock](https://github.com/langchain-ai/langgraph/issues/7259)
- [Forum: Does the Postgres Checkpointer serialize concurrent FastAPI requests?](https://forum.langchain.com/t/does-the-postgres-checkpointer-serialize-concurrent-fastapi-requests/2882)
- [LangGraph memory and state persistence — checkpointers, threads, cross-session memory](https://www.abstractalgorithms.dev/langgraph-memory-and-state-persistence)
- [aio-pika repository](https://github.com/mosquito/aio-pika)
- [FastAPI + aio-pika boilerplate (reference structure)](https://github.com/kieled/fastapi-aiopika-boilerplate)

---

*Architecture research for: Brain — LangGraph orchestration service*
*Researched: 2026-05-21*
