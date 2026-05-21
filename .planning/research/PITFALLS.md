# Domain Pitfalls — Brain

**Domain:** LangGraph-based multi-bot AI orchestration service (Python, async, Postgres + vector DB, RabbitMQ + webhook ingress, multi-provider LLM fallback, Langfuse observability, Docker Compose)
**Researched:** 2026-05-21
**Severity scale:** CRITICAL (data loss / silent corruption) / HIGH (degraded behavior visible to callers) / MEDIUM (operational pain)

This document catalogs failures that hit *exactly* this shape of system. Every pitfall has been mapped to a roadmap phase so the planner can sequence mitigations rather than discovering them in production.

---

## 1. LangGraph footguns

### 1.1 Checkpointer schema breaks across `langgraph-checkpoint-postgres` minor versions — CRITICAL

**What goes wrong.** The minor upgrade from `langgraph-checkpoint-postgres` 2.0.21 → 2.0.22 changed metadata serialization from `JsonPlus` (tolerant of `HumanMessage`, `datetime`, etc.) to a raw `Jsonb(...)` cast. Old checkpoints that stored non-JSON Python objects in metadata now raise `Object of type HumanMessage is not JSON serializable` on read, and some users hit `TypeError: 'NoneType' object is not a mapping` reading legacy rows after upgrades. There is *no* automatic migration story; you can lose access to in-flight sessions on a routine `pip upgrade`.

**Warning signs.**
- A `pip-compile`/`uv lock` regenerate bumps the checkpointer minor and CI is silent (because nobody has a regression test that reads an *old* checkpoint with a *new* library).
- Unit tests pass because they create state fresh inside the same test.
- Stack traces in prod containing `JSON serializable` or `'NoneType' object is not a mapping` originating in `langgraph.checkpoint.postgres`.

**Prevention.**
- Pin `langgraph`, `langgraph-checkpoint`, and `langgraph-checkpoint-postgres` to exact versions in `pyproject.toml`; do *not* use `^` or `~` on these three.
- Write a "legacy checkpoint replay" test: snapshot a serialized checkpoint to a fixture file, commit it, and assert it loads on every upgrade.
- Forbid non-JSON-serializable objects in `metadata`. Channel state can carry `HumanMessage` etc.; metadata cannot. Enforce in a `pre-commit` lint that grep-blocks `metadata={...HumanMessage...}`.
- Upgrade in a dedicated PR with a manual checklist: dump prod checkpoints schema (`pg_dump -s`), upgrade in staging, run replay test, then promote.

**Phase.** Architecture phase (decide pinning strategy and migration test pattern). Re-checked at every dependency upgrade.

Source: [Issue #5862 — Breaking change on minor version of langgraph-checkpoint-postgres after 2.0.21](https://github.com/langchain-ai/langgraph/issues/5862), [Issue #6137 — langgraph postgresql checkpointer support old checkpoints](https://github.com/langchain-ai/langgraph/issues/6137).

### 1.2 Sync `PostgresSaver` inside an async FastAPI/aio-pika worker silently blocks the event loop — HIGH

**What goes wrong.** LangGraph ships two checkpointers: `PostgresSaver` (sync, uses `psycopg`/`ConnectionPool`) and `AsyncPostgresSaver` (async, uses `AsyncConnectionPool`). The sync one works inside an async app but every checkpoint write blocks the event loop on a synchronous psycopg call. Under any concurrency the request latency p99 turns into a sawtooth and RabbitMQ heartbeat misses fire.

**Warning signs.**
- FastAPI `/healthz` latency rises proportional to in-flight LLM calls (it shouldn't — health checks shouldn't share a thread with graph execution).
- `aio_pika` logs `heartbeat timeout` while LLM calls succeed.
- `py-spy dump` of the main thread shows it parked in `psycopg.Connection.execute`.

**Prevention.**
- Use `AsyncPostgresSaver.from_conn_string(...)` (or the explicit `AsyncConnectionPool`) everywhere. Treat `PostgresSaver` as a sync-only escape hatch reserved for one-off CLI scripts.
- Add a lint/CI grep: ban `from langgraph.checkpoint.postgres import PostgresSaver` outside `scripts/`.
- Bound the async pool: `AsyncConnectionPool(max_size=10, min_size=2)`; expose `pool.get_stats()` on `/metrics` so saturation is visible.
- Single integration test: fire 50 concurrent graph invocations against a single worker; assert p95 latency < 2× single-request latency.

**Phase.** Architecture phase (lock the async-everywhere rule before any node is written).

Source: [AsyncPostgresSaver reference](https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver), [langgraph-checkpoint-postgres PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/).

### 1.3 Blocking calls inside async nodes (sync `openai`, `requests`, `time.sleep`) — HIGH

**What goes wrong.** A node is declared `async def` but inside it calls `openai.OpenAI().chat.completions.create(...)` (sync client) or `requests.get(...)`. The whole event loop stalls for the duration of the LLM call. With LangGraph's parallel `Send` API this is hidden — the graph "feels" parallel because nodes are scheduled, but they execute serially.

**Warning signs.**
- Two concurrent requests take ~2× as long as one (linear scaling = sequential execution).
- `asyncio.get_event_loop().slow_callback_duration` warnings.
- Langfuse traces show overlapping spans on paper but real wall-clock starts staircase.

**Prevention.**
- Use the async clients exclusively: `AsyncOpenAI`, `genai.Client().aio.models`, `httpx.AsyncClient`.
- Wrap the only legitimately-sync thing (e.g. a tokenizer) in `asyncio.to_thread(...)`, never call it directly.
- Add a runtime guard: in dev, set `asyncio.get_event_loop().set_debug(True)` and `PYTHONASYNCIODEBUG=1`; log slow-callback warnings as test failures in CI.
- Concurrency test (from 1.2) doubles as the regression for this.

**Phase.** Hot-path phase (when first LLM node is written, lock the async-client choice).

### 1.4 Non-deterministic node side effects break LangGraph time-travel/replay — MEDIUM

**What goes wrong.** LangGraph's checkpointer enables `get_state_history()` and replay-from-checkpoint. Replay re-executes nodes from a saved state. If a node performs a non-idempotent side effect — `INSERT INTO message_history`, RabbitMQ publish, billing event — replay double-fires it. The Brain spec stores last-10-msgs in Postgres *inside* the graph; naively this means every replay duplicates messages.

**Warning signs.**
- Debugging a failed session triggers duplicate rows in `message_history`.
- An operator using LangGraph Studio "rewinds" a session and a webhook fires twice on the downstream bot.
- Vector DB has duplicate embeddings for the same content.

**Prevention.**
- Use deterministic idempotency keys for every external write: `(thread_id, node_name, step, content_hash)`. Make the SQL `INSERT ... ON CONFLICT DO NOTHING`.
- Separate "thinking" nodes (pure, replayable) from "effect" nodes (must commit). Put effect nodes at the end of the graph, after `interrupt_after` checkpoints.
- Never publish to RabbitMQ from inside a node. Stage the outbound payload in graph state and publish *once* after `ainvoke` returns, from the orchestrator outside the graph.
- Test: invoke a graph, snapshot state, replay from a midpoint, assert row counts are unchanged.

**Phase.** Architecture phase (effect-vs-thinking node convention is structural).

### 1.5 Default `recursion_limit = 25` cuts off real conversations — MEDIUM

**What goes wrong.** LangGraph's default `recursion_limit` counts *supersteps*, not LLM calls. A graph with a tool-use loop, a memory-fetch node, a model-call node, and a fallback node burns 4 supersteps per turn. A long agentic session (or an infinite loop from a misbehaving LLM) hits the limit mid-conversation with `GraphRecursionError`, and the request fails with a confusing error.

**Warning signs.**
- Sporadic `GraphRecursionError` in Langfuse only on longer sessions.
- The number of supersteps per turn is not explicitly documented anywhere in the repo.

**Prevention.**
- Decide explicitly: "Brain's graph uses N supersteps per turn; recursion_limit = N × max_turns_per_invocation + safety_margin". Document in `ARCHITECTURE.md`.
- Set `config={"recursion_limit": 50}` on `ainvoke` calls; do not rely on default.
- Add an explicit cycle-breaker node that counts loop iterations in state and raises a typed `BrainTurnLimitError` *before* LangGraph's generic error fires, so the caller gets a structured 422 instead of an opaque 500.

**Phase.** Hot-path phase.

Source: [GRAPH_RECURSION_LIMIT docs](https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT), [Issue #5883](https://github.com/langchain-ai/langgraph/issues/5883).

### 1.6 Checkpointer table grows unbounded — HIGH

**What goes wrong.** Every superstep writes a checkpoint row. Long-running threads accumulate hundreds of rows; popular sessions can produce GB of `jsonb` blobs over weeks. There is no built-in TTL or pruning in `langgraph-checkpoint-postgres`. Query latency on `checkpoints` table degrades; backups balloon.

**Warning signs.**
- `pg_total_relation_size('checkpoints')` growing faster than message volume justifies.
- p99 latency on `aget_state()` rising over weeks.

**Prevention.**
- Decide a checkpoint retention policy on day 1: e.g. keep latest 20 checkpoints per thread, plus everything from the last 24h. Implement as a nightly `DELETE` cron in the same DB (NOT a TRUNCATE; you'll break live threads).
- Add `(thread_id, checkpoint_id)` index check at setup; verify `EXPLAIN ANALYZE` of `aget_state` uses it.
- Track `checkpoints` row count and table size as a Prometheus metric; alert on > 10× expected.

**Phase.** Hardening phase (after first production data exists to size policy from).

Source: [Issue #1138 — How do I keep data in Postgres checkpointer from growing unbounded](https://github.com/langchain-ai/langgraphjs/issues/1138).

---

## 2. Multi-provider fallback gotchas

### 2.1 Heterogeneous error shapes make "is this retriable?" unanswerable — HIGH

**What goes wrong.** OpenAI raises `openai.RateLimitError`, `openai.APITimeoutError`, `openai.BadRequestError` (which can wrap a content policy violation — NOT retriable). Google's `google.genai` raises `google.genai.errors.APIError` with HTTP-style `code` fields, `ResourceExhausted` for quota, and surface model-overloaded as `503`. If the fallback layer naively catches `Exception`, it will fall back from OpenAI to Gemini on a content-policy violation that Gemini will *also* refuse, burning latency and cost. If it catches too narrowly, it'll fail on genuinely transient errors.

**Warning signs.**
- Fallback fires on requests the user reformulates and resends successfully on the primary — meaning the original error was a 4xx, not a 5xx, and you fell back for nothing.
- p50 latency on fallback path > 2× primary path because both providers were called for non-retriable errors.

**Prevention.**
- Build a small `ProviderError` taxonomy: `TRANSIENT`, `RATE_LIMIT`, `BAD_INPUT`, `CONTENT_POLICY`, `AUTH`, `UNKNOWN`. Each provider adapter maps native exceptions into this enum. Only `TRANSIENT` and `RATE_LIMIT` trigger fallback.
- Table-driven unit tests: feed each known native error class and assert the taxonomy mapping. Refresh quarterly.
- Log the raw provider error class to Langfuse `metadata`, never just the taxonomy — so misclassifications can be spotted retroactively.

**Phase.** Hot-path phase (provider-abstraction layer is core).

### 2.2 Partial response on provider A, then fallback to provider B — CRITICAL

**What goes wrong.** OpenAI streams 200 tokens, then the connection dies with a `httpx.ReadError`. You're not streaming to the user (Brain is non-streaming in v1), but the LangChain/`AsyncOpenAI` invocation may still raise mid-flight. What happens next?
- If you fall back to Gemini, the *user-visible* response is from Gemini only — but Langfuse trace will show "OpenAI 200 tokens" *and* "Gemini full response", inflating cost and breaking attribution.
- If you stitch them, you've Frankensteined two different model continuations.
- If you replay LangGraph from before the LLM node, you've potentially charged for tokens that aren't in the response.

**Warning signs.**
- Langfuse trace shows two model spans on a single request, but `model_used` field returns only the second.
- Token usage report sum doesn't match provider invoice.

**Prevention.**
- All-or-nothing rule: on partial-response error from provider A, *discard* whatever was returned and call provider B from scratch. Document this in `ARCHITECTURE.md`.
- Record both spans in Langfuse but tag the discarded one with `metadata={"discarded": true, "reason": "partial_failure"}`. Cost accounting code must filter on `discarded=false`.
- Reconciliation test: replay a week of traces, sum `cost` for non-discarded spans, compare to provider invoice. Variance should be < 1%.

**Phase.** Observability phase (the cost-accounting half) + hot-path phase (the fallback policy half).

### 2.3 Token counting and cost attribution diverge between providers — MEDIUM

**What goes wrong.** OpenAI returns `usage.prompt_tokens` / `completion_tokens` directly. Gemini returns `usage_metadata.prompt_token_count` / `candidates_token_count` and counts differently (Gemini tokenizes UTF-8 differently from OpenAI's `tiktoken`). Token-counting *before* the call (e.g. for budgeting / context-window check) using `tiktoken` against a Gemini call is wrong by ~10-30% depending on language. For Portuguese (likely audience here per email TLD `.com.br`), the divergence is larger than for English.

**Warning signs.**
- "Context exceeded" errors only on Gemini for prompts your `tiktoken` count said were safe.
- Cost dashboards inconsistent with provider invoices.

**Prevention.**
- Never pre-count tokens with `tiktoken` for Gemini-bound prompts. Use provider-specific counters: `genai.Client().models.count_tokens(...)` for Gemini, `tiktoken` for OpenAI. Wrap behind the same `count_tokens(provider, model, content)` interface.
- Store `provider`, `model`, `prompt_tokens`, `completion_tokens` as separate columns/fields in usage logs. Do NOT sum across providers without weighting by per-provider price.
- Reconciliation test from 2.2 catches this too.

**Phase.** Observability phase.

### 2.4 Structured outputs: OpenAI strict mode has no exact Gemini equivalent — HIGH

**What goes wrong.** OpenAI's `response_format={"type": "json_schema", "strict": true}` *guarantees* schema conformance (via constrained decoding). Gemini supports JSON Schema and propertyOrdering, but enforcement is best-effort — Gemini can still emit unparseable JSON or omit `required` fields. If Brain ever uses structured outputs (e.g. for a routing node, a tool-call schema), and fallback to Gemini happens, the parse will fail downstream where it never failed on OpenAI.

**Warning signs.**
- A new structured-output feature works in dev (OpenAI primary) and fails in prod (during a Gemini fallback window).
- Pydantic `ValidationError` only on Gemini-flagged Langfuse traces.

**Prevention.**
- Validate every structured output through Pydantic on *both* paths regardless of "strict" mode. Treat OpenAI's strict guarantee as a perf optimization, not a correctness one.
- If Pydantic validation fails on Gemini fallback, retry once with an additional system message ("Return ONLY valid JSON matching the schema."). If still failing, surface a typed error to caller — do NOT fall back to "the OpenAI response we discarded".
- Test: golden-fixtures of malformed Gemini outputs (collect during dev) → assert the retry-and-fail path is exercised.

**Phase.** Hot-path phase (when first structured-output node ships).

Source: [Google announces JSON Schema for Gemini](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [JSON for LLMs comparison guide](https://superjson.ai/blog/2025-08-17-json-schema-structured-output-apis-complete-guide/).

### 2.5 Rate-limit handling differs in retry-headers — MEDIUM

**What goes wrong.** OpenAI returns `Retry-After` and detailed `x-ratelimit-*` headers. Gemini's `ResourceExhausted` does not give a retry-after; you must back off blind. A naive exponential backoff against Gemini hammers it with mistimed retries.

**Prevention.**
- Provider adapter exposes `retry_after_seconds: Optional[float]`; if None, use jittered exponential. Honor the field when present.
- Cap retries at 2 per provider per request; after that, fall through to the other provider.

**Phase.** Hot-path phase.

---

## 3. Memory consistency

### 3.1 Concurrent requests for same `sessionId` produce stale "last 10 messages" — CRITICAL

**What goes wrong.** Two messages for the same session arrive ~simultaneously (user double-taps, gateway retries, two bot adapters fan-in). Request A reads last-10 → builds prompt → calls LLM → writes message. Request B reads last-10 *before* A writes → builds prompt missing A's message → calls LLM → writes message. The conversation history now has interleaved replies that don't reference each other, and the vector store has two competing semantic-recall states. The bot looks schizophrenic.

**Warning signs.**
- User reports "the bot answered my second question as if I never sent the first".
- LangGraph thread state shows two checkpoint chains for the same `thread_id` (impossible in single-writer; sign of concurrent execution).

**Prevention.**
- Per-`sessionId` serialization. Two options:
  - **Postgres advisory lock**: each request takes `pg_advisory_xact_lock(hashtext(sessionId))` for the duration of the graph invocation. Cheap, correct, scoped to the connection.
  - **In-process asyncio.Lock keyed by sessionId**: works only with a single Brain instance. Reject for any multi-replica deploy.
- LangGraph's checkpointer already serializes per-`thread_id` on writes, but reads are NOT serialized; you need an external lock that spans the *whole* turn (read memory → call LLM → write).
- Test: fire 5 concurrent requests with identical sessionId, assert message_history rows are strictly ordered and each prompt seen by the LLM includes all prior turns.

**Phase.** Architecture phase (concurrency model is foundational), tested in hot-path phase.

### 3.2 Embedding model drift makes old vectors incomparable — CRITICAL

**What goes wrong.** Bot has 6 months of vector memory using `text-embedding-3-small` (1536 dims). You switch to `text-embedding-3-large` (3072 dims) for better recall. pgvector / Qdrant / Weaviate require fixed-dimension columns; old vectors are either unreadable, or readable but semantically incomparable with new ones (cosine distance between embeddings from different models is meaningless). Long-term memory recall silently returns garbage.

**Warning signs.**
- A change to `EMBEDDING_MODEL` env var doesn't crash anything but vector search relevance scores collapse.
- Code path uses `vector` (untyped) instead of `vector(N)` — no error at write time, then silent comparison.

**Prevention.**
- Store `embedding_model_id` alongside every vector. Query filter: `WHERE embedding_model_id = $current_model`.
- Versioned indices: switching model means a new index/collection (`embeddings_v2`) that gets backfilled. Old index stays read-only for fallback.
- Treat embedding model as part of the schema. Migration plan = re-embedding job. Document expected re-embedding cost (tokens × cost per provider) in the migration runbook.
- CI check: assert `vector(EXPECTED_DIM)` typed columns; ban untyped `vector`.

**Phase.** Architecture phase (decide single-vs-multi-model story), Hardening phase (build the re-embedding job).

Source: [pgvector — different dimensions](https://community.openai.com/t/how-to-deal-with-different-vector-dimensions-for-embeddings-and-search-with-pgvector/602141/2), [Issue #442 — text-embedding-3-large not compatible](https://github.com/pgvector/pgvector/issues/442), [pgvector DBA guide March 2026](https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/).

### 3.3 Embedding latency on the hot path — HIGH

**What goes wrong.** Every incoming user message gets embedded to do semantic memory recall, *then* the LLM is called. OpenAI's `text-embedding-3-small` adds 80-300ms on top of every turn — for a webhook that's expected to respond in <2s, that's 15% of the budget gone before the LLM runs.

**Prevention.**
- Run memory recall (embed + vector query) in parallel with prompt assembly using `asyncio.gather`. The LLM call awaits both, not sequentially.
- Cache embeddings of the *exact* incoming message string (LRU keyed by `hash(text) + model_id`); same-message replays (retries, duplicate webhook deliveries) skip the embed call.
- Local embedding model option for v2 (BGE-small, etc.) is a known follow-up; do NOT block v1 on this.

**Phase.** Hot-path phase.

### 3.4 Vector index grows unbounded per bot — HIGH

**What goes wrong.** Every message in every session gets a vector. Per-bot rows grow linearly; HNSW index build/search time grows with row count; storage cost on the vector DB volume grows. No TTL means a 1-year-old bot has 100× the memory of a 1-week-old one with no recall benefit (old context is rarely relevant).

**Warning signs.**
- Vector query latency rises monotonically over weeks.
- Volume disk usage climbs faster than message volume justifies (because index size = data size × ~2).

**Prevention.**
- TTL policy from day 1: vectors older than N days are deleted (configurable per bot). Implement as a nightly job.
- Per-`(botId, sessionId)` cap: keep the most recent K vectors per session.
- HNSW reindex schedule when fragmentation hits a threshold; alert if index size > 3× data size.
- Capacity model in `ARCHITECTURE.md`: "Bot at 1000 sessions × 100 turns × 1536 dims × float32 = ~600MB raw + index."

**Phase.** Architecture phase (TTL policy) + Hardening phase (reindex automation).

### 3.5 Vector store double-write on retry / replay — HIGH

**What goes wrong.** Webhook caller retries on timeout. The graph already wrote a vector but didn't return the HTTP 200 in time. Retry runs the whole graph again — second vector for the same content. Over time, search results are polluted by duplicates and recall quality degrades (top-K is filled with the same memory).

**Prevention.**
- Idempotency key on the vector upsert: `point_id = sha256(botId|sessionId|content_hash)`. Vector DB upsert (not insert) means retries are no-ops.
- Webhook layer also has idempotency: `Idempotency-Key` header or hash of `(botId, sessionId, conteudo, timestamp_bucket)` — return cached 200 for duplicates within 60s.

**Phase.** Hot-path phase.

---

## 4. RabbitMQ pitfalls

### 4.1 Auto-ack loses messages when worker crashes during LLM call — CRITICAL

**What goes wrong.** Default `auto_ack=True` (or `no_ack=True` in older clients) means RabbitMQ marks a message delivered the moment it leaves the broker. If the worker OOMs, crashes, or is OOM-killed by Docker during the 20-second LLM call, the message is gone — user gets no reply, no trace, no dead-letter, nothing.

**Prevention.**
- Manual ack always. `auto_ack=False`, ack only *after* the response is published to `brain.out` and the LangGraph checkpoint is committed.
- Test: kill -9 the worker mid-LLM-call (use `os.kill(os.getpid(), signal.SIGKILL)` in a test node); assert the message is redelivered on restart.

**Phase.** Architecture phase (ack policy locked before first consumer is written).

Source: [RabbitMQ Consumers docs](https://www.rabbitmq.com/docs/consumers), [CloudAMQP prefetch optimization](https://www.cloudamqp.com/blog/how-to-optimize-the-rabbitmq-prefetch-count.html).

### 4.2 Manual ack + long LLM call exceeds RabbitMQ delivery-ack timeout — CRITICAL

**What goes wrong.** RabbitMQ has a default 30-minute consumer delivery acknowledgement timeout. Normally fine. But: GPT-4.1 stalled mid-response, a tool-call retry loop, or Gemini's overloaded-503 backoff can push a single turn past 5+ minutes — and if the worker has prefetched 10 messages and processes them serially, the 10th message's ack arrives well past the timeout. RabbitMQ closes the channel with `PRECONDITION_FAILED`, all unacked messages are requeued, the worker reconnects, processes them again, hits the same timeout — poison loop.

**Warning signs.**
- `PRECONDITION_FAILED - delivery acknowledgement on channel X timed out` in worker logs.
- Same `messageId` processed multiple times in Langfuse.
- Queue depth oscillates instead of draining.

**Prevention.**
- Set `consumer_timeout` in `rabbitmq.conf` explicitly (e.g. 1 hour) and document the assumption: any single turn must finish in less than this.
- Set `prefetch_count=1` per worker. With LLM workloads, throughput comes from horizontal worker scaling, not prefetch depth. Documented best practice for variable-duration tasks.
- Per-LLM-call timeout *inside* the worker (e.g. `httpx.Timeout(connect=10, read=120)`) so a stuck provider doesn't burn the RabbitMQ ack budget.
- Test: simulate a 35-minute artificial sleep in a node; assert the message lands in DLQ, not in a reprocess loop.

**Phase.** Architecture phase (prefetch + timeout config locked) + Hardening phase (poison-loop test).

Source: [RabbitMQ Consumers — Delivery Acknowledgement Timeout](https://www.rabbitmq.com/docs/consumers), [Michal Drozd — 5000 Unacked Messages](https://www.michal-drozd.com/en/blog/rabbitmq-ack-contracts/).

### 4.3 No DLX on `brain.in` causes poison-message infinite loop — CRITICAL

**What goes wrong.** A malformed payload (missing `botId`, JSON parse error, persona not found in DB) raises in the consumer. The handler does `nack(requeue=True)` (or worse, lets the exception kill the consumer, triggering RabbitMQ's redelivery). The same message is dequeued, fails the same way, immediately re-enters the queue. The worker spins at 100% CPU processing one bad message forever. Other messages starve.

**Prevention.**
- Declare `brain.in` with `x-dead-letter-exchange = brain.dlx` and `x-dead-letter-routing-key = brain.dlq`. Declare `brain.dlq` as a regular queue with no consumers (or a low-volume monitoring consumer).
- On any unrecoverable error (validation, persona-not-found, repeat-failure-count > 3), `nack(requeue=False)` to send to DLQ.
- Add `x-death` header inspection: if a message has been redelivered > N times, DLQ it.
- Test: publish a malformed payload; assert it lands in `brain.dlq` within seconds, NOT looping in `brain.in`.

**Phase.** Architecture phase (queue topology) + Hardening phase (DLQ replay tooling).

### 4.4 Queue declaration drift between dev and prod — HIGH

**What goes wrong.** Dev worker declares `brain.in` with `durable=True, x-message-ttl=86400000`. Prod worker, deployed earlier, declared it with `durable=True` and no TTL. On startup the new worker calls `queue_declare` with mismatched args → RabbitMQ refuses with `PRECONDITION_FAILED`. The worker crashes, the deploy fails, or worse — someone manually deletes the queue and loses in-flight messages.

**Prevention.**
- Centralize queue declarations in a single `topology.py` module. Apply via a one-shot init container (`brain-topology-init`) in Docker Compose, not at consumer startup.
- Make consumer code declare queues `passive=True` (assert exists, do not create). Topology mismatches surface as startup errors, not in-flight failures.
- Version the topology: include a `topology_version` env that the init container checks and refuses to deploy if downgrading.

**Phase.** Architecture phase.

### 4.5 Response delivery ordering breaks with variable LLM latency — MEDIUM

**What goes wrong.** Two messages from the same session enter `brain.in`. Message 1 routes to Gemini (slow today, 8s). Message 2 routes to OpenAI (fast, 2s). Worker 2 replies to `brain.out` first; the bot adapter delivers reply-to-msg-2 before reply-to-msg-1 — out-of-order conversation.

**Prevention.**
- Per-`sessionId` serialization (see 3.1) also fixes this: only one in-flight turn per session.
- Include `originalMessageId` and a monotonic per-session `turnIndex` in every response so the downstream adapter can re-order if it must.
- Document that ordering is enforced *by session*, not globally.

**Phase.** Architecture phase.

---

## 5. Auth & security

### 5.1 Bearer token leaked into Langfuse traces / logs — CRITICAL

**What goes wrong.** FastAPI auto-logs request headers in debug mode. LangChain auto-instrumentation captures the full incoming payload as a span input. The `Authorization: Bearer xyz123` header is now in Langfuse, in stdout (then shipped to Loki/CloudWatch), and in any error report (Sentry, etc.). Anyone with read access to observability tools has prod auth.

**Warning signs.**
- A grep for `Bearer ` over your own Langfuse export returns hits.
- Sentry has events containing `authorization` keys.

**Prevention.**
- Strip auth headers *before* they reach any logging or tracing layer. Use a FastAPI middleware that pops `Authorization` from `request.scope["headers"]` after auth check.
- Langfuse: configure `LANGFUSE_MASK_INPUTS` patterns or implement a `mask` callback that redacts known secret keys.
- Static analysis: pre-commit hook scanning for `logger.info(request.headers)` patterns.
- Test: integration test sends a request with a known-canary token; assert the token does NOT appear in the Langfuse trace export.

**Phase.** Hot-path phase (auth middleware shipped with first webhook) + Observability phase (redaction in Langfuse exporter).

### 5.2 PII in `conteudo` logged in plaintext — HIGH

**What goes wrong.** Real bot traffic carries CPF/CNPJ, emails, addresses, medical content. The default LangChain Langfuse callback captures node inputs verbatim. Operators looking at Langfuse traces see user PII. LGPD violation (relevant given user is in Brazil based on `.com.br` email).

**Prevention.**
- Decide policy in `ARCHITECTURE.md`: trace inputs are redacted by default; full content is opt-in per bot (`bot.trace_full_content: bool` column).
- Use Langfuse's data-masking config OR a custom callback handler that runs a PII regex/Presidio over inputs before they ship.
- Self-hosted Langfuse helps but does not eliminate this — internal access ≠ no access.
- Retention: configure Langfuse data TTL (e.g. 30 days) so old traces don't accumulate liability.

**Phase.** Observability phase (PII pipeline) + Hardening phase (LGPD-specific review).

### 5.3 Provider API keys in `.env` committed to git — CRITICAL

**What goes wrong.** Developer copies `.env.example` → `.env`, fills in real OpenAI key, commits "just for testing". Key is now in git history forever. Provider revokes it 6 hours later when GitHub's secret scanner pings them. Production breaks.

**Prevention.**
- `.gitignore` includes `.env`, `.env.local`, `.env.*` (only `.env.example` exempted). Verify with a `git check-ignore .env` step in CI.
- `pre-commit` hook with `gitleaks` or `detect-secrets`.
- Provider keys are NEVER passed via `.env` in prod; use Docker Compose `secrets:` (file-based) or a real secret manager. `.env` is dev-only.
- README explicitly states: keys are not committed, period. Onboarding step is "ask the team for keys", not "find them in the repo".

**Phase.** Architecture phase (repo hygiene from day 1).

### 5.4 RabbitMQ default credentials `guest:guest` reachable on Docker network — HIGH

**What goes wrong.** Default `rabbitmq:3-management` Docker image starts with `guest:guest`. The `guest` user is restricted to localhost by default, but in Docker Compose every service container shares a network where any container *is* localhost from RabbitMQ's POV in some configurations. A misconfigured `loopback_users` setting + an attacker who pops one container = full RabbitMQ admin.

**Prevention.**
- Set `RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS` in compose, never use `guest`.
- Verify `loopback_users.guest = true` (default in recent images) is still set.
- Management UI (port 15672) NOT published to host in prod; access via SSH tunnel.
- Per-service credentials: `brain` user with permissions only on `brain.*` queues, not full admin.

**Phase.** Architecture phase (compose hygiene).

### 5.5 No Bearer token rotation story — MEDIUM

**What goes wrong.** Single static token in env. Token leaks (per 5.1). Rotation requires editing env on every bot adapter and Brain at the same time → downtime, or "we'll do it next week" → it never gets rotated.

**Prevention.**
- Support a *list* of valid Bearer tokens (env var `BRAIN_AUTH_TOKENS=tok1,tok2`). Rotation = add new, deploy adapters with new, remove old.
- Each token tagged with a name in Langfuse metadata (`auth_token_name`) so you can see which adapter is using which token and which to deprecate first.

**Phase.** Hardening phase.

---

## 6. Docker Compose realities

### 6.1 Brain starts before Postgres/RabbitMQ/Vector DB are ready — HIGH

**What goes wrong.** `depends_on` without `condition: service_healthy` only waits for the container to *start*, not for the service inside it to accept connections. Brain boots, tries `AsyncPostgresSaver.setup()`, Postgres isn't ready, exception, container restarts. Eventually it works, but startup is flaky and CI is non-deterministic.

**Prevention.**
- Every dependency declares a `healthcheck:`. Brain `depends_on: postgres: { condition: service_healthy }`, same for RabbitMQ, vector DB, Langfuse.
- Brain's own startup retries connections with exponential backoff for 60s before crashing — defense in depth.
- Test: `docker compose down && docker compose up`; the whole stack must reach healthy in < 90s deterministically.

**Phase.** Architecture phase.

### 6.2 Langfuse needs its own Postgres + ClickHouse + Redis + S3-compatible store — HIGH

**What goes wrong.** Self-hosted Langfuse v3 is not a single container; it requires Postgres (separate from Brain's!), ClickHouse, Redis, and a blob store (MinIO works for compose). Devs assume "Langfuse = one container" and the compose file becomes a Frankenstein when they discover otherwise mid-build.

**Prevention.**
- Use Langfuse's official `docker-compose.yml` as a subtree or a `langfuse.yml` profile that's `include`d in the main compose file.
- Two Postgres instances: `postgres-brain` and `postgres-langfuse`. NEVER share schemas; cross-contamination of migrations is a nightmare.
- Document expected memory footprint in `STACK.md`: full stack is realistically 4-6GB RAM on a dev machine.

**Phase.** Architecture phase (now, before someone designs around "one Postgres for everything").

Source: [Langfuse self-hosting troubleshooting](https://langfuse.com/self-hosting/troubleshooting-and-faq).

### 6.3 `docker compose down -v` wipes prod-like dev data — MEDIUM

**What goes wrong.** Dev runs `down -v` to "reset the env"; loses the seeded bot personas, the long-running test session, the labeled Langfuse traces they were using as reference.

**Prevention.**
- Named volumes with stable names (`brain_postgres_data`, not anonymous). `down -v` flag becomes deliberate.
- A `make seed` target re-seeds bot personas idempotently after volume reset.
- README: "Volumes wipe is non-recoverable; use `make reset-soft` for a `down && up` that preserves volumes."

**Phase.** Architecture phase (dev ergonomics).

### 6.4 Dev image == prod image is a mistake; pure-prod image is also a mistake — MEDIUM

**What goes wrong.** Either dev installs `pytest`/`ruff`/`ipython` into the prod image (bloat, supply-chain surface), OR prod doesn't have any debug tools (operator can't `pip install ipdb` to debug a stuck container).

**Prevention.**
- Multi-stage Dockerfile: `base` → `dev` (adds dev deps) → `prod` (FROM base, no dev deps). Two tags from one Dockerfile.
- `docker-compose.yml` targets prod; `docker-compose.dev.yml` overrides to dev image. Default `docker compose up` is dev.

**Phase.** Architecture phase.

### 6.5 Secrets via `.env` doesn't scale beyond one machine — MEDIUM

**What goes wrong.** Compose `.env` is fine on a dev laptop. On a remote VM you scp it. On 3 VMs you scp it 3 times and they drift. Eventually someone bakes a key into a Docker image and force-pushes.

**Prevention.**
- Use Docker Compose `secrets:` for any value containing `KEY`, `TOKEN`, `PASSWORD`, `SECRET`. Compose `secrets` resolve via file paths, not env, so they don't leak via `docker inspect`.
- For real prod: pick one of Doppler / Infisical / SOPS / AWS SSM and document the path. Even just "we store the real `.env` in 1Password and pull on deploy" is better than no story.

**Phase.** Hardening phase.

---

## 7. Postgres-as-three-things load

### 7.1 Schema sprawl: LangGraph tables + Brain tables + history tables in one DB — HIGH

**What goes wrong.** LangGraph's `setup()` creates `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations`. Brain owns `bots`, `messages`, `bot_versions`. If everything is in the public schema, naming collisions are a question of time; `pg_dump` exports a confusing mix; Alembic autogenerate sees LangGraph tables and tries to "manage" them (it shouldn't).

**Prevention.**
- Use Postgres schemas: `langgraph.*` (managed by `langgraph-checkpoint-postgres`), `brain.*` (managed by Alembic), `brain_history.*` if appropriate.
- Alembic `version_table_schema='brain'`, `include_schemas=True`, and `include_object` filter that excludes the `langgraph` schema.
- Test: drop both schemas, run Alembic `upgrade head` AND LangGraph `setup()`, assert both succeed independently.

**Phase.** Architecture phase (schema layout locked before first migration ships).

Source: [Issue #465 — Postgres Schema for LangGraph Checkpointer](https://github.com/langchain-ai/docs/issues/465).

### 7.2 Two migration systems racing on startup — HIGH

**What goes wrong.** Both LangGraph's `await checkpointer.setup()` and Alembic's `upgrade head` run at app boot. With multiple Brain replicas, both race on table-creation locks. Sometimes both succeed; sometimes one deadlocks and the container OOMs at startup.

**Prevention.**
- Migrations run in a dedicated `brain-migrate` init container that completes before any worker starts. Workers run with `setup()` *skipped* — they call `aget_state` directly assuming schema exists.
- Init container exits 0 only when both Alembic and `langgraph.setup()` complete. Workers `depends_on: brain-migrate: { condition: service_completed_successfully }`.

**Phase.** Architecture phase.

### 7.3 Backup/restore complexity hidden until prod incident — MEDIUM

**What goes wrong.** A restore from yesterday's `pg_dump` rolls back Brain personas to yesterday's state but leaves LangGraph checkpoints from today — checkpoints reference personas (via embedded prompt content) that may no longer exist. Threads silently lose context.

**Prevention.**
- Backup policy: dump both schemas atomically, restore atomically.
- Persona references in checkpoints should be by ID + version, never by embedded content; if a persona ID is missing on restore, the graph raises a typed error instead of running on stale data.
- Quarterly restore drill: restore the full backup into a staging stack and run a smoke-test session.

**Phase.** Hardening phase.

---

## 8. Langfuse traces in failure modes

### 8.1 Langfuse down → Brain requests fail — CRITICAL

**What goes wrong.** Langfuse's SDK by default batches and ships asynchronously, but a misconfiguration (sync mode, or `flush_at=1`) can make every request block on a Langfuse HTTP call. November 2025 had a multi-hour Langfuse Cloud outage; self-hosted instances have weekly maintenance windows. If a Langfuse outage takes Brain down, that's the worst possible coupling — observability is supposed to be optional.

**Prevention.**
- Langfuse callback must be fire-and-forget. Configure `langfuse.Langfuse(flush_interval=5, flush_at=100)` and accept some trace loss on crash.
- Wrap every Langfuse call in a try/except that swallows failures and logs to stdout as a fallback.
- Circuit breaker: if Langfuse fails N times in M seconds, disable the callback for the next 60s. Test by pointing `LANGFUSE_HOST` at an unreachable port — assert request latency unchanged, assert a metric `langfuse_circuit_open` goes high.

**Phase.** Observability phase.

Source: [Langfuse Nov 2025 incident report](https://langfuse.com/blog/2025-11-20-incident-report), [Langfuse troubleshooting](https://langfuse.com/self-hosting/troubleshooting-and-faq).

### 8.2 Auto-instrumentation misses manually-wrapped calls; token attribution wrong — MEDIUM

**What goes wrong.** LangChain's auto-callback wires up token tracking when you use `ChatOpenAI` / `ChatGoogleGenerativeAI`. The moment you call the provider SDK *directly* (e.g. inside a custom node that does retries with its own httpx client), auto-instrumentation has no idea — Langfuse trace shows tokens=0 for that call, total cost is wrong.

**Prevention.**
- Pick a stance and stick to it: either "everything goes through LangChain's `ChatModel` interface" (then auto-instrumentation is reliable) OR "we wrap our own provider client and manually emit Langfuse spans with usage". Document which.
- If manual wrap: every provider adapter calls `langfuse.update_current_observation(usage_details={"input": ..., "output": ...})` after every call. Code review checklist item.
- Reconciliation: nightly job sums per-provider tokens from Langfuse, compares to provider invoice. > 5% variance triggers an alert.

**Phase.** Observability phase.

### 8.3 Trace context lost across async / queue boundaries — MEDIUM

**What goes wrong.** RabbitMQ-consumed request starts a trace in worker process A. Worker uses `asyncio.create_task` for memory-fetch parallelism. The task runs without the parent trace context (because `contextvars` aren't auto-propagated to detached tasks in some configurations). Langfuse shows orphan spans.

**Prevention.**
- Use `asyncio.gather` (preserves context) instead of `create_task` for in-request fan-out.
- For RabbitMQ → worker, propagate a `traceparent` header via message properties and `Langfuse.trace(id=...)` to continue the trace.
- Test: invoke via RabbitMQ, fetch the trace from Langfuse, assert it has all expected spans and no orphans.

**Phase.** Observability phase.

---

## 9. Bot persona CRUD edge cases

### 9.1 Updating a bot's prompt mid-conversation — HIGH

**What goes wrong.** Session is active, has 8 turns of history with persona "Friendly Support Bot". Operator updates persona via CRUD to "Formal Compliance Bot". Next turn: does the LLM see the new prompt or the old one? If new: tonal whiplash, user notices. If old: when does it switch? Never (until a new session)? After the current session ends? It's not defined.

**Prevention.**
- Persona is versioned. `bots.id` + `bots.version`. Each session pins to a `(bot_id, bot_version)` at first message. Updating creates a new version row; old version is retained.
- New sessions use latest version; existing sessions stay on the pinned version until they explicitly end or are migrated.
- API to explicitly "migrate session to latest persona" if operator wants to force it.
- Document in `ARCHITECTURE.md`: "Personas are immutable per session for the session lifetime."

**Phase.** Hot-path phase (when persona CRUD ships).

### 9.2 Soft-delete vs hard-delete — HIGH

**What goes wrong.** Operator deletes a bot. Existing sessions still arrive with that `botId`. Brain can't resolve persona → 404 → user gets no reply, OR Brain falls back to a default persona → user gets a completely different conversation style mid-thread.

**Prevention.**
- Soft-delete only via the API: `bots.deleted_at`. Existing sessions can still resolve. Webhook rejects *new* sessions on soft-deleted bots with `410 Gone`.
- Hard-delete only via an explicit DB-level operation with a documented runbook (and only after a session-drain period).
- Test: soft-delete a bot, send a message on an existing session → succeeds. Send a message on a new session → 410.

**Phase.** Hot-path phase.

### 9.3 Persona prompt size unbounded — MEDIUM

**What goes wrong.** Operator pastes a 30k-token prompt into the persona field. Every turn now starts with 30k tokens of context — 30× the cost, latency spikes, OpenAI context window pressure on GPT-4.1's 1M-token limit isn't the issue but Gemini 2.5 Flash's effective context drops quality past a threshold.

**Prevention.**
- DB-level CHECK constraint: `LENGTH(system_prompt) < 16000` characters (≈4k tokens). Reject at CRUD layer with 422.
- Token-count check in the CRUD validator using provider-appropriate counter.
- Per-bot config `max_system_prompt_tokens` override for special cases.

**Phase.** Hot-path phase.

---

## 10. Per-session memory + per-bot isolation interplay

### 10.1 SessionId collisions across bots — CRITICAL

**What goes wrong.** Two bot adapters (WhatsApp gateway A, Telegram gateway B) both happen to use `sessionId="user_123"` (a phone number, a chat ID, a UUID generated identically). LangGraph thread is keyed on `thread_id`. If `thread_id = sessionId`, bot A's conversation history bleeds into bot B's prompt. Catastrophic privacy / context leak.

**Warning signs.**
- Quality regressions only on specific bots, hard to reproduce.
- Langfuse trace for bot B contains messages bot A's persona supposedly answered.

**Prevention.**
- `thread_id` is ALWAYS `f"{botId}:{sessionId}"`, never just `sessionId`. Enforce in a single helper function, ban string concatenation elsewhere.
- Vector DB query filter ALWAYS includes `botId`. Wrap the vector client so a query without `botId` raises at runtime.
- Test: two bots, identical sessionId, two messages — assert each bot only sees its own history.

**Phase.** Architecture phase (the thread-id convention is foundational).

### 10.2 Vector DB query missing the `botId` filter — CRITICAL

**What goes wrong.** Junior dev writes `qdrant.search(query_vector=v, limit=5)` without the `must` filter. Memory recall returns vectors from any bot. Bot A's persona memory ends up in bot B's prompt.

**Prevention.**
- Ban direct vector client usage. All vector queries go through `brain.memory.VectorMemory.recall(bot_id, session_id, query)` — the only API. Linter rule blocks raw client imports outside that module.
- Default vector client wrapped to raise if `filter` arg is missing or doesn't contain `bot_id`.
- Test: try to recall without bot_id → assertion error.

**Phase.** Architecture phase.

### 10.3 Cross-session leak via shared embeddings cache — HIGH

**What goes wrong.** Embedding cache (per 3.3) is keyed on `(text, model)` only — not on `(bot_id, text, model)`. Bot A embeds "what's our return policy" and caches. Bot B sends the same string; gets bot A's embedding (fine, it's the same vector) — but then the cache could be extended later to memoize *recall results*, which would leak across bots. Forward-looking risk.

**Prevention.**
- Embedding cache: text-only key is OK (text → vector is bot-independent).
- Recall cache: MUST be keyed on `(bot_id, session_id, query)`. Encode this in the cache key helper and unit-test it.

**Phase.** Hot-path phase.

### 10.4 Per-bot vector collections vs single filtered collection — MEDIUM

**What goes wrong.** Choice deferred: one collection with `bot_id` payload filter (operationally simpler, larger index) vs one collection per bot (cleaner isolation, deletion just drops a collection, but N collections to manage). Picking the wrong one is hard to reverse at 100 bots.

**Prevention.**
- Decide in the vector-DB research phase (Phase 1) based on candidate's filter performance: Qdrant filters well, can use single-collection. Weaviate per-class might justify per-bot. Document.
- Either way, abstract behind `VectorMemory` — switching strategies should be one module change.

**Phase.** Architecture phase (decision now), Hardening phase (revisit at scale).

---

## Phase-Specific Warnings (Roadmap Mapping)

| Phase | Critical Pitfalls to Address First |
|-------|------------------------------------|
| **Architecture / Foundations** | 1.1 (checkpointer pinning), 1.2 (async-only DB), 1.4 (effect vs thinking nodes), 3.1 (session serialization), 3.2 (embedding model versioning), 4.1 (manual ack), 4.2 (consumer timeout / prefetch), 4.3 (DLQ topology), 4.4 (queue declaration centralization), 4.5 (ordering rule), 5.3 (.env hygiene), 5.4 (RabbitMQ creds), 6.1 (healthchecks), 6.2 (separate Langfuse Postgres), 6.4 (multi-stage Dockerfile), 7.1 (schema namespaces), 7.2 (init-container migrations), 10.1 (botId:sessionId thread key), 10.2 (vector query wrapper), 10.4 (single vs per-bot collections) |
| **Hot Path (first webhook + first LLM call)** | 1.3 (async clients), 1.5 (recursion limit), 2.1 (error taxonomy), 2.2 (partial-response policy), 2.4 (Pydantic-validate always), 2.5 (retry-after), 3.3 (embed in parallel), 3.5 (idempotent vector upsert), 5.1 (auth-header redaction), 9.1 (persona versioning), 9.2 (soft-delete behavior), 9.3 (prompt size caps), 10.3 (cache key scoping) |
| **Observability** | 2.3 (token counting per provider), 5.2 (PII redaction), 8.1 (Langfuse circuit breaker), 8.2 (instrumentation completeness), 8.3 (trace context propagation) |
| **Hardening** | 1.6 (checkpoint retention), 3.4 (vector TTL + reindex), 4.3 (DLQ replay tooling), 5.5 (token rotation), 6.3 (volume policy), 6.5 (secrets beyond .env), 7.3 (backup/restore drill), 10.4 (revisit collection strategy) |

## Severity Summary

**CRITICAL (data loss / silent corruption):** 1.1, 2.2, 3.1, 3.2, 4.1, 4.2, 4.3, 5.1, 5.3, 8.1, 10.1, 10.2 — twelve issues. Most cluster in the foundational architecture phase; this is the phase that cannot be rushed.

**HIGH (degraded behavior):** 1.2, 1.3, 1.6, 2.1, 2.4, 3.3, 3.4, 3.5, 4.4, 5.2, 5.4, 6.1, 6.2, 7.1, 7.2, 9.1, 9.2, 10.3 — eighteen issues.

**MEDIUM (operational pain):** 1.4, 1.5, 2.3, 2.5, 4.5, 5.5, 6.3, 6.4, 6.5, 7.3, 8.2, 8.3, 9.3, 10.4 — fourteen issues.

## Sources

- [Issue #5862 — Breaking change langgraph-checkpoint-postgres 2.0.22](https://github.com/langchain-ai/langgraph/issues/5862)
- [Issue #6137 — langgraph postgresql checkpointer support old checkpoints](https://github.com/langchain-ai/langgraph/issues/6137)
- [Issue #1138 — Postgres checkpointer unbounded growth](https://github.com/langchain-ai/langgraphjs/issues/1138)
- [Issue #5883 — recursion limit per-node tracking](https://github.com/langchain-ai/langgraph/issues/5883)
- [Issue #465 — Postgres Schema for LangGraph Checkpointer](https://github.com/langchain-ai/docs/issues/465)
- [GRAPH_RECURSION_LIMIT docs](https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT)
- [AsyncPostgresSaver reference](https://reference.langchain.com/python/langgraph.checkpoint.postgres/aio/AsyncPostgresSaver)
- [langgraph-checkpoint-postgres on PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/)
- [RabbitMQ Consumers — Delivery Acknowledgement Timeout](https://www.rabbitmq.com/docs/consumers)
- [RabbitMQ Consumer Prefetch](https://www.rabbitmq.com/docs/consumer-prefetch)
- [CloudAMQP — Optimize the RabbitMQ Prefetch Count](https://www.cloudamqp.com/blog/how-to-optimize-the-rabbitmq-prefetch-count.html)
- [Michal Drozd — 5000 Unacked Messages](https://www.michal-drozd.com/en/blog/rabbitmq-ack-contracts/)
- [pgvector — dimensions for embeddings (OpenAI community)](https://community.openai.com/t/how-to-deal-with-different-vector-dimensions-for-embeddings-and-search-with-pgvector/602141/2)
- [Issue #442 — text-embedding-3-large not compatible with pgvector 5.1](https://github.com/pgvector/pgvector/issues/442)
- [pgvector DBA guide — Indexes (March 2026)](https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/)
- [Langfuse incident report Nov 18, 2025](https://langfuse.com/blog/2025-11-20-incident-report)
- [Langfuse self-hosting troubleshooting](https://langfuse.com/self-hosting/troubleshooting-and-faq)
- [Google — JSON Schema support in Gemini](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [JSON for LLMs — Structured Outputs comparison guide (Aug 2025)](https://superjson.ai/blog/2025-08-17-json-schema-structured-output-apis-complete-guide/)
