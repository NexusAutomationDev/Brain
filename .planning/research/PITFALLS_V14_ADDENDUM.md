
---

## v1.4 Addendum: RAG + Tool Events + FUP Automático Pitfalls

> These pitfalls are specific to adding RAG (text ingestion → chunking → embedding → pgvector), Tool Event publishing (fire-and-forget side-channel), and FUP Automático (DB-persisted scheduler with multiple Brain instances) to the existing Brain Core v1.3 system (Bun + LangGraph 1.3.7 + postgres.js + PostgresSaver + pgvector). All previously documented pitfalls (amqplib, bun:sql, pg_advisory_lock/PgBouncer, withStructuredOutput + bindTools, MCP transport underscore, PostgresSaver pool leak) are already solved — do not repeat them here.

---

## RAG Pitfalls

### RAG-01: Embedding Model Drift — Changing Models Silently Corrupts All Existing Embeddings

**Severity:** CRITICAL

**What goes wrong:** When the `EMBEDDING_MODEL` env var is changed (e.g., from `text-embedding-3-small` at 1536 dims to `text-embedding-3-large` at 3072 dims, or to a Gemini model at 768 dims), the new query embedding is generated in a completely different vector space from the embeddings already stored in pgvector. The cosine distance calculation between a new-space query vector and old-space stored vectors returns plausible-looking numbers — there is no error, no exception, no warning — but the results are meaningless. The LLM receives irrelevant chunks and hallucinates answers confidently.

**Why it happens:** Different embedding models produce vectors in geometrically incompatible spaces. The similarity score between a `text-embedding-3-small` vector and a `text-embedding-3-large` vector is a random number between -1 and 1 with no semantic meaning. The existing `embeddings` table in this codebase already guards against dimension mismatch at write time (`vector(EMBEDDING_DIM)` column), which will throw a pgvector dimension error if the dimension changes. But if only the model changes while the dimension stays the same (e.g., switching from one 1536-dim model to another 1536-dim model with different training), writes succeed silently and retrieval is corrupted with no error.

**Consequences:** RAG returns garbage chunks. LLM hallucinates. Users experience degraded or wrong answers. The failure is undetectable without an evaluation harness — no runtime error fires.

**How to avoid:**
- Store `embedding_model` and `embedding_model_version` as non-nullable columns in the `knowledge` table (the new table for RAG ingestion), populated at write time from `EMBEDDING_MODEL` env.
- At query time, assert that `EMBEDDING_MODEL` matches the model used for ingestion — if they differ, refuse to search and log an alert.
- Add a startup assertion that compares `EMBEDDING_MODEL` against a `SELECT DISTINCT embedding_model FROM knowledge` query — if multiple values exist, the DB is in a mixed state.
- Treat embedding model changes as database migrations: re-embed ALL existing chunks before the new model goes live. Use a blue-green strategy: ingest with the new model into a new collection, validate recall quality, then switch traffic.
- Never allow `EMBEDDING_MODEL` to be changed without a full re-index. Document this as an operational constraint.

**Warning signs:**
- RAG search returns results that are semantically unrelated to the query (but no error is thrown)
- `SELECT DISTINCT embedding_model FROM knowledge` returns more than one value
- User-reported hallucinations increased shortly after a model change or dependency upgrade
- Recall evaluation score drops sharply after a deployment

**Phase to address:** RAG ingestion phase (ingest endpoint and `search_knowledge` tool). The `embedding_model` column must exist in the migration from day one — it cannot be added after data is already stored.

---

### RAG-02: pgvector Column Dimension Mismatch Between Embedding Model and Schema

**Severity:** HIGH

**What goes wrong:** The `embeddings` table already uses `vector(EMBEDDING_DIM)` where `EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMENSIONS, 10)`. The new RAG `knowledge` table for v1.4 must use the same env var. If `EMBEDDING_DIMENSIONS` in Docker Compose / Kubernetes differs from the value used during the migration that created the column, every INSERT will fail with pgvector's hard error: `ERROR: expected N dimensions, not M`. This error surfaces at runtime during ingestion, not at startup.

A more subtle variant: `GoogleGenerativeAIEmbeddings` (already in the embedding factory) does not accept `output_dimensionality` as a constructor parameter — the library silently ignores it and produces 3072-dim vectors regardless of the setting. If `EMBEDDING_DIMENSIONS=1536` but `LLM_PROVIDER=gemini`, the insert fails with a dimension error.

**How to avoid:**
- Add a startup assertion in `createEmbeddings()` that generates a test embedding for a known string and asserts `embedding.length === parseInt(process.env.EMBEDDING_DIMENSIONS)`. Throw `ConfigurationError` if they differ. This runs once at startup and surfaces mismatches before any real document is ingested.
- For the Gemini case specifically: verify that `GoogleGenerativeAIEmbeddings` supports dimension control and document the supported output dimensions explicitly. If not controllable, lock `LLM_PROVIDER=gemini` to a specific known dimension.
- Add the startup assertion as a smoke test in CI: run `bun test` with mismatched `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` values and assert that startup fails loudly.

**Warning signs:**
- `ERROR: expected N dimensions, not M` in ingest endpoint logs shortly after a provider or env change
- Ingest endpoint returns 500 but health check returns 200 (dimension check is not in the health check path)
- Google provider embeddings always produce 3072-dim vectors regardless of env setting

**Phase to address:** RAG ingestion phase. The startup assertion must be in the initial embedding factory implementation.

---

### RAG-03: HNSW Index Pre-Filter Recall Degradation — Collection Isolation via Metadata Column

**Severity:** HIGH

**What goes wrong:** The v1.4 RAG design uses a single `knowledge` table with a `collection_name` column to isolate chunks per knowledge base (e.g., `collection_name = 'sdr_products'`). The `search_knowledge` tool queries: `WHERE collection_name = $1 ORDER BY embedding <=> $query LIMIT $k`. With the HNSW index on the `embedding` column, pgvector 0.7.x applies the ANN search first (returning `ef_search = 40` candidates) and then filters by `collection_name`. If only 20% of stored vectors belong to the target collection, pgvector returns roughly 8 results (20% of 40) — far fewer than the requested K, silently degrading recall without any error.

pgvector 0.8.0 introduced iterative index scans (`hnsw.iterative_scan = relaxed_order`) that scan beyond the initial candidate set until K filtered results are found. This mitigates the problem but adds latency proportional to the filter selectivity.

**Why it happens:** pgvector's HNSW index has no native support for filtered ANN search. Filtering happens post-index as a WHERE clause applied to the approximate candidates — not inside the index itself. The default `ef_search = 40` is sized for full-collection queries, not filtered queries against a subset.

**How to avoid:**
- Enable iterative scans in the query session before filtered vector searches:
  ```sql
  SET hnsw.iterative_scan = relaxed_order;
  SET hnsw.max_scan_tuples = 20000;
  SELECT ... FROM knowledge WHERE collection_name = $1 ORDER BY embedding <=> $query LIMIT $k;
  ```
- Add a partial index per collection if the number of collections is bounded and small (< 10): `CREATE INDEX knowledge_sdr_idx ON knowledge USING hnsw (embedding vector_cosine_ops) WHERE collection_name = 'sdr_products'`. This gives full recall for queries on that specific collection at the cost of one index per collection.
- Set `hnsw.ef_search = 100` (not the default 40) for filtered searches to increase the candidate pool before filtering. This trades latency for recall.
- Validate recall: after ingesting test data with known answers, query with the collection filter and assert that the expected chunk appears in the top-K results. If it doesn't, recall is already degraded.
- Document the collection naming convention: collection names must be stable — they are used as HNSW partial index names and query filter values; changing them requires new indexes.

**Warning signs:**
- `search_knowledge` returns fewer results than requested K even when enough data exists
- LLM complains of incomplete context when the knowledge base has relevant content
- Collection filter is highly selective (< 30% of all knowledge rows match it) — this is the high-risk case

**Phase to address:** RAG ingestion phase (when the `knowledge` table schema and `search_knowledge` tool are defined). The iterative scan setting must be in the tool's query, not added later.

---

### RAG-04: Chunking Strategy — Too Small Loses Context, Too Large Dilutes Signal

**Severity:** HIGH

**What goes wrong:** Two failure modes at opposite ends of the spectrum:

1. **Chunks too small (< 128 tokens):** Each chunk is a sentence fragment. The embedding captures only local syntax, not semantic meaning. Retrieval finds lexically similar chunks but they lack the surrounding context needed to answer multi-sentence questions. The LLM receives fragments and fabricates missing context.

2. **Chunks too large (> 1024 tokens):** A single chunk contains multiple topics. The embedding averages the semantic signals, making the chunk rank moderately relevant for many queries but not highly relevant for any. RAG accuracy research (PMC Bioengineering 2025) showed this single variable swings accuracy from 50% to 87% on identical pipelines.

**A specific risk for the SDR knowledge base:** Sales playbooks, product FAQs, and objection-handling scripts often have natural paragraph boundaries that are semantically complete units. Splitting mid-paragraph (using pure character count) breaks semantic units and loses context at boundaries.

**How to avoid:**
- Use `@langchain/textsplitters` `RecursiveCharacterTextSplitter` with `chunkSize: 512` and `chunkOverlap: 50` as the starting point. These values work for most prose text.
- For structured content (FAQs, numbered lists): use `MarkdownTextSplitter` if the source is Markdown, which splits on headers and preserves list structure.
- Apply 10-20% overlap (e.g., `chunkOverlap: 50` for `chunkSize: 512`) to prevent information loss at chunk boundaries.
- Do NOT use `TokenTextSplitter` with tiktoken in Bun — tiktoken uses WebAssembly with Node.js-specific loading that has known compatibility issues in non-Node runtimes. Use character-based splitting instead. If token-accurate splitting is required, use `cl100k_base` via `@dqbd/tiktoken` (pure JS) not the Rust-compiled version.
- Store `chunk_index` and `total_chunks` in the knowledge table so the LLM can detect when retrieved chunks are partial fragments of a larger document.
- Validate chunk quality by sampling 10 chunks after ingest and manually confirming they make sense in isolation.

**Warning signs:**
- LLM answers contain fragments that are cut mid-sentence or mid-idea
- The same factual question returns different answers depending on phrasing (retrieval is inconsistent)
- Ingest pipeline crashes with WASM or native module errors when using tiktoken

**Phase to address:** RAG ingestion phase. Chunk strategy is set at ingest time and cannot be changed without re-ingesting all documents.

---

### RAG-05: `tiktoken` Native Module Fails in Bun — Use Pure-JS Alternative

**Severity:** MEDIUM

**What goes wrong:** `langchain`'s `TokenTextSplitter` uses `@dqbd/tiktoken` under the hood, which compiles a Rust/WASM encoder. In Bun, WASM loading has inconsistencies: the WASM binary path may not resolve correctly under Bun's module resolver, and the native binding (`.node` file) is a Node.js add-on that Bun may refuse to load. This causes a `ReferenceError` or `ENOENT` when the splitter is instantiated, crashing the ingest endpoint at the first request after startup.

A related issue reported on AWS Lambda Node.js 18.x (similar constraint environment): `Error with @dqbd/tiktoken when using RecursiveCharacterTextSplitter` fails at WASM instantiation.

**How to avoid:**
- Do not use `TokenTextSplitter` in the Bun-based ingest service. Use `RecursiveCharacterTextSplitter` with character-based sizing (not token-based). Character count is an acceptable proxy: 512 characters ≈ 100-150 tokens for English prose.
- If token-accurate splitting is truly required: use `js-tiktoken` (pure TypeScript, no WASM, no native bindings) — it is the official tiktoken port that avoids native module issues.
- Add a test in `__tests__/unit/` that imports the text splitter module and splits a known string — this will catch native module errors at CI time, not at production ingest time.

**Warning signs:**
- Ingest endpoint starts fine but crashes on first POST with a WASM or native module error
- `Error: Cannot find module '@dqbd/tiktoken/tiktoken_bg.wasm'` in logs
- The error only appears in Bun runtime, not during local Node.js testing

**Phase to address:** RAG ingestion phase, in the initial splitter selection. Choose the character-based splitter from the start.

---

## Tool Event Publishing Pitfalls

### EVT-01: Tool Event Publisher Blocks the LangGraph Flow — Fire-and-Forget Must Be Non-Awaited

**Severity:** CRITICAL

**What goes wrong:** The Tool Event system is designed to publish a `{ action, lead, result }` payload to a side-channel (webhook or RabbitMQ) when a LangGraph tool executes. If the publisher `await`s the delivery confirmation before returning from the tool function, the LangGraph tool call is blocked waiting for the external system to acknowledge receipt. A slow webhook (500ms latency) or RabbitMQ confirm timeout adds that latency to every tool call, turning a 2-second Brain turn into a 2.5-second turn or more.

Worse: if the external endpoint is down, the `await` blocks until timeout. If there is no timeout, the tool call hangs indefinitely — LangGraph's ToolNode waits forever, the RabbitMQ consumer's `prefetch(1)` stalls, and no new messages are processed.

**How to avoid:**
- Publish events using fire-and-forget: call the publisher function but do NOT await it:
  ```typescript
  // In the tool function body — publish is intentionally not awaited
  void eventPublisher.publish({ action: 'qualify_lead', lead, result }).catch(err => {
    logger.warn({ err }, 'Tool event publish failed (non-fatal)');
  });
  return result; // Tool returns immediately
  ```
- Set a maximum timeout on the publisher internally — if the external system does not acknowledge within 2 seconds, resolve the promise with a warning, never reject.
- Log a warning on publish failures but never throw or propagate errors to the LangGraph ToolNode. Tool event publishing is optional infrastructure; the tool's primary function (executing business logic) must succeed regardless.
- Add a test that simulates a failing event publisher and asserts the tool still returns its result normally within the expected time window.

**Warning signs:**
- Average tool call latency increases after adding the event publisher
- RabbitMQ consumer `prefetch(1)` appears stuck (no new messages processed) when the event webhook is down
- LangGraph traces in Langfuse show tool nodes with unusually long execution times
- Integration tests time out intermittently when the event webhook mock is slow

**Phase to address:** Tool Events phase, during the initial publisher design. The non-await contract must be established before the first tool is wired.

---

### EVT-02: Lead Data Not Available in Tool Closure Context — Thread ID vs Lead Object

**Severity:** HIGH

**What goes wrong:** Tool Event payloads require `{ action, lead: { id, numero, nome }, result }`. LangGraph tools in Brain Core are defined as closures that receive `sql` at factory time (e.g., `createPauseSessionTool(sql)`) but do NOT receive the current lead object — that data lives in `BrainRunner.run()` scope but is not passed into the tool factory. When a tool fires, it has access to `thread_id` via `configurable` (from LangGraph's `RunnableConfig`) but not directly to the lead object.

If the tool tries to include lead data in the event payload by querying the DB inside the tool function, this adds a DB roundtrip to every tool execution (violates EVT-01's non-blocking contract) and creates a new DB query that must be closed carefully to avoid the PostgresSaver pool leak pattern (already documented in v1.3).

**How to avoid:**
- Pass the lead object into the tool factory at brain-run time, not at graph-compile time:
  ```typescript
  // In BrainRunner.run(event):
  const lead = await LeadService.upsert(...);
  const tools = buildToolsWithLead(sql, lead, eventPublisher); // lead passed at run time
  const config = { configurable: { thread_id: lead.uniqueId } };
  await compiledGraph.invoke(input, config);
  ```
- Alternatively, stash the lead in LangGraph state (`BrainStateAnnotation`) and have the tool read it from `state.lead` — but this requires lead data to be a first-class state field.
- Do NOT query the lead inside the tool function. The lead object is always available at `BrainRunner.run()` time and must be threaded through the call chain.
- For the event payload specifically: the minimum useful payload is `{ action, lead_unique_id, result }` — use `thread_id` (which equals `lead.uniqueId`) as the lead identifier in the event. The consumer of the event can look up full lead data using `unique_id` if needed.

**Warning signs:**
- Tool event payload contains `lead: undefined` or `lead: null` in published events
- Tool function makes an unexpected DB query (visible in postgres slow query log) for every tool invocation
- `configurable.thread_id` is undefined inside the tool function (lead data was never threaded)

**Phase to address:** Tool Events phase. The lead threading pattern must be decided before any tool is wired with the event publisher.

---

### EVT-03: RabbitMQ Publish to Undefined or Misconfigured Queue Silently Drops Events

**Severity:** HIGH

**What goes wrong:** If `TOOL_EVENTS_QUEUE` env var is missing or points to a non-existent queue, `rabbitmq-client`'s `publisher.send(queue, payload)` using the default exchange will silently drop the message — RabbitMQ routes to a queue by name using the default exchange, and if no queue with that name exists, the message is discarded without error. The existing `RabbitMQTransport` (`confirm: true`) would surface this as a failed publish confirmation, but a new event publisher that does not use `confirm: true` will never know.

**How to avoid:**
- Use `confirm: true` on the event publisher, even though the publish is fire-and-forget. The `confirm` flag ensures the broker has received and routed the message (or returned a nack). Log a warning on nack but do not block:
  ```typescript
  // In EventPublisher — confirm mode catches routing failures without blocking caller
  const pub = rabbit.createPublisher({ confirm: true });
  // send() returns a Promise<void> — catch but don't await from caller
  pub.send(queue, payload)
    .then(() => logger.debug({}, 'Tool event published'))
    .catch(err => logger.warn({ err }, 'Tool event publish nacked (queue may not exist)'));
  ```
- At startup, validate that `TOOL_EVENTS_QUEUE` is set if `TOOL_EVENTS_TRANSPORT=rabbitmq`. Throw `ConfigurationError` if missing (same pattern as existing RabbitMQ transport).
- Do NOT declare the queue from the publisher — queues must be pre-configured by ops (same decision as existing `RabbitMQTransport`, constraint D-14). But log a clear warning at startup if the queue can't be verified.
- Add a startup integration test that publishes one test event and confirms it is received — this catches misconfiguration before any real tool fires.

**Warning signs:**
- Tool event logs show "published" but no events appear in the queue consumer
- `TOOL_EVENTS_QUEUE` is undefined in env and no startup error fires
- RabbitMQ management UI shows zero messages in the events queue despite tool calls completing

**Phase to address:** Tool Events phase. The startup validation and `confirm: true` pattern must be in the first publisher implementation.

---

### EVT-04: Circular Dependency — Event Publisher Importing from Transport, Transport Importing from Core

**Severity:** HIGH

**What goes wrong:** The event publisher needs to publish to RabbitMQ (importing from `packages/transport`) or send an HTTP webhook (importing from `packages/core` or a shared HTTP utility). If `packages/transport` itself imports `EventPublisher` (to call it from inside the RabbitMQ consumer), a circular dependency forms: `transport → event-publisher → transport`. Bun resolves circular imports by returning the partially-initialized module (the export is `undefined` at import time), causing `TypeError: eventPublisher.publish is not a function` at runtime — a bug that only appears when the tool fires inside a RabbitMQ consumer, not in webhook mode.

**Why it happens:** Tool events must be triggered from inside LangGraph tool functions. Tools are registered in `packages/core` or `apps/brain-*/`. The event publisher needs access to a transport primitive (RabbitMQ connection or HTTP client). If the same transport package that provides the consumer also exports the publisher, any code in core that imports the publisher transitively imports the entire transport package, creating cross-package coupling.

**How to avoid:**
- Create `packages/events` as a standalone package with a single responsibility: `EventPublisher` interface + webhook and RabbitMQ implementations. It imports from `packages/shared` (for types) and `rabbitmq-client` directly — never from `packages/transport` and never from `packages/core`.
- `packages/transport` does NOT import from `packages/events`. The tool registration in `packages/core` imports `packages/events` only.
- Dependency graph (no cycles): `shared ← events ← core ← apps/brain-*` and `shared ← transport ← apps/brain-*`.
- Run `madge --circular packages/` (or `bun x madge`) in CI to detect circular imports before they merge.
- Add a test in `__tests__/unit/` that imports `EventPublisher` and asserts it is not `undefined` — this catches the partial-initialization symptom.

**Warning signs:**
- `eventPublisher.publish is not a function` at runtime (classic circular-import symptom)
- The error only appears when `TRANSPORT=rabbitmq`, not `TRANSPORT=webhook` (different import paths)
- `madge --circular` reports a cycle involving `transport` → `events` → `transport`

**Phase to address:** Tool Events phase, during initial package design. Package boundaries must be defined before any implementation starts.

---

### EVT-05: Tool Node Re-execution on LangGraph Resume Causes Duplicate Event Publishes

**Severity:** MEDIUM

**What goes wrong:** If a tool node is interrupted mid-execution (process kill, timeout, network failure) and the Brain restarts with the same `thread_id`, LangGraph resumes from the last checkpoint. If the checkpoint was written BEFORE the tool node completed (before the ToolMessage was written), LangGraph re-executes the tool node from the beginning. The tool's business logic runs again AND the event publisher fires again — the external system receives a duplicate `{ action, lead, result }` event for the same tool call.

This is the "SAGA double-fire" problem: the event side effect cannot be wrapped in a transaction with the LangGraph checkpoint write.

**How to avoid:**
- Include a stable `event_id` in every published event, derived from the LangGraph `tool_call_id` (available in the ToolNode's AIMessage context):
  ```typescript
  const eventId = `${thread_id}:${tool_call_id}`; // stable across retries
  await publisher.publish({ event_id: eventId, action, lead, result });
  ```
- The consumer of the tool events must implement idempotency using `event_id` — if the same `event_id` arrives twice, the second occurrence is a no-op.
- Document this as a known at-least-once delivery guarantee: tool events are published at-least-once, never exactly-once. The consumer must be idempotent.
- This is acceptable for the v1.4 use case (external CRM notification, logging) but would be a blocker for financial transactions or state-mutating operations.

**Warning signs:**
- External system receives duplicate events with the same tool result for the same lead
- The duplicate appears only after a Brain restart or pod eviction (not in normal operation)
- The `event_id` field is absent from the published payload (impossible to deduplicate downstream)

**Phase to address:** Tool Events phase. Document the at-least-once guarantee in the API contract from day one. Add `event_id` to the payload schema before any consumer is built against it.

---

## FUP Scheduler Pitfalls

### FUP-01: Multiple Brain Instances Run the Same Scheduler — Double-Send Without Distributed Lock

**Severity:** CRITICAL

**What goes wrong:** The FUP Automático scheduler runs a `setInterval` that scans for leads whose `next_fup_at` has passed and sends a follow-up message. If two Brain instances are running simultaneously (Docker Compose scale, Kubernetes replica > 1, rolling deployment overlap), both instances run the scheduler, both find the same overdue lead, and both call the LLM and send a follow-up. The lead receives two FUP messages within milliseconds of each other.

This is not a race condition that resolves itself — both instances will repeatedly double-send for every FUP cycle until one is shut down.

**How to avoid:**
- Use PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` to claim FUP records atomically. Only the instance that wins the lock sends the FUP:
  ```sql
  -- Run inside a transaction — only one instance claims this lead's FUP slot
  BEGIN;
  SELECT id, lead_id, step FROM fup_schedule
  WHERE next_fup_at <= NOW() AND status = 'pending'
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  -- If row returned: update status = 'in_progress', commit, then send FUP
  -- If no row returned (SKIP LOCKED): another instance claimed it — commit and skip
  ```
- After the FUP message is sent: update `status = 'sent'`, set `next_fup_at` for the next step (or `status = 'completed'` if last step).
- If the LLM call or send fails: update `status = 'pending'` again so another instance can retry it on the next scheduler tick.
- This pattern requires NO external infrastructure (no Redis, no separate lock service) — uses the PostgreSQL connection already in the stack.
- `FOR UPDATE SKIP LOCKED` is compatible with PgBouncer transaction mode (the lock is held within the transaction, released on commit) — unlike advisory locks.
- Add an integration test that starts two scheduler instances against the same DB and asserts only one FUP is sent per lead per step.

**Warning signs:**
- Leads receive duplicate FUP messages (especially during deployments when two instances overlap)
- `fup_schedule` table shows the same row with two `updated_at` timestamps within milliseconds
- WhatsApp/CRM logs show duplicate messages from the Brain

**Phase to address:** FUP scheduler phase, during the initial scheduler design. The `SKIP LOCKED` pattern must be in the first implementation — retrofitting it after double-sends are reported in production is costly.

---

### FUP-02: Scheduler State Lost on Process Restart — Must Persist `next_fup_at` in DB

**Severity:** CRITICAL

**What goes wrong:** An in-memory scheduler (e.g., `setTimeout` storing the next FUP time in a variable or Map) loses all scheduled state on container restart. Since Bun/Node.js processes restart frequently (deployments, crashes, OOM kills, Docker health check failures), any lead whose FUP timer was held in memory will never receive their follow-up. This is silent — no error, no retry, no alert.

**Why it happens:** Developers prototype with `setTimeout(sendFUP, delay)` because it's simple and it works in development. They forget that the development process runs continuously for hours; in production, containers restart multiple times per day.

**How to avoid:**
- Store all FUP state in the DB `fup_schedule` table with columns: `lead_id`, `step` (current FUP step 1/2/3), `next_fup_at` (absolute UTC timestamp for the next FUP), `status` (`pending`, `in_progress`, `sent`, `cancelled`, `completed`).
- On startup, the scheduler queries `WHERE status = 'pending' AND next_fup_at <= NOW()` to immediately process any FUPs that were due while the process was down.
- Use a polling interval (every 60 seconds is sufficient) instead of `setTimeout` per lead. Polling a DB table for ready rows is more robust than managing N individual timers.
- Never store scheduled time in process memory. Always derive the next action time from the DB.
- Add a test that simulates a process restart by instantiating the scheduler, stopping it, instantiating a new scheduler from a cold start, and verifying that pending FUPs from before the restart are processed.

**Warning signs:**
- Leads who stopped responding during a deployment window never receive their FUPs
- After a container restart, the scheduler log shows zero scheduled items despite overdue FUPs in the DB
- Monitoring shows gaps in FUP sends that correlate exactly with deployment times

**Phase to address:** FUP scheduler phase, during initial schema design. The `fup_schedule` table must exist before any scheduler code is written.

---

### FUP-03: Timezone DST Transition Causes FUP to Fire at Wrong Hour

**Severity:** HIGH

**What goes wrong:** The FUP scheduler must respect business hours and timezone rules (e.g., "only send FUPs between 9 AM and 6 PM, Monday through Friday, in America/Sao_Paulo timezone"). When Daylight Saving Time (DST) transitions occur (Brazil: typically November and February), a naive implementation may:
1. Fire a "9 AM" FUP at 8 AM (the clock was moved forward — the UTC offset changed from -3 to -2)
2. Skip a FUP entirely because the configured time falls in the DST gap (clocks jump from 11:59 PM to 1:00 AM, skipping midnight)
3. Fire a FUP twice during the "fall back" transition where one UTC hour maps to two local hours

The subtle bug: if `next_fup_at` is stored as a UTC timestamp computed at the time the FUP was scheduled (e.g., "9 AM tomorrow" → stored as 12:00 UTC assuming -3 offset), but DST changes the offset to -2 by "tomorrow," the stored UTC value 12:00 now maps to 10 AM local time — the FUP fires one hour late.

**How to avoid:**
- Store `next_fup_at` in UTC always. Never store local time in the DB.
- Compute `next_fup_at` using a timezone-aware library (use `Temporal` or `date-fns-tz` — do NOT use the built-in `Date` object for timezone arithmetic). Compute "9 AM tomorrow in America/Sao_Paulo" as a UTC instant at scheduling time using the correct DST-adjusted offset for that specific date:
  ```typescript
  import { fromZonedTime, toZonedTime } from 'date-fns-tz';
  // Compute UTC equivalent of "9 AM on 2026-11-03 in America/Sao_Paulo"
  // This correctly handles DST (Nov 3 is in daylight saving period in Brazil)
  const nextFupUtc = fromZonedTime('2026-11-03 09:00:00', 'America/Sao_Paulo');
  ```
- Recompute `next_fup_at` at scheduling time (when the lead goes silent) rather than storing a relative offset (e.g., "+ 24 hours") — relative offsets do not account for DST transitions that occur within the offset window.
- Use `Croner` as the scheduler polling cron if human-readable schedules are needed — it uses the `Intl` API for DST-aware timezone handling, unlike `node-cron` which has historical DST issues.
- Test FUP scheduling specifically around Brazilian DST transition dates (first Sunday of November, third Sunday of February).

**Warning signs:**
- FUPs arrive 1 hour early or late in October-November or February-March
- Leads report receiving FUPs outside business hours during DST transition weeks
- `next_fup_at` UTC values appear consistent but local-time equivalents are wrong after a DST change

**Phase to address:** FUP scheduler phase. Timezone handling must be correct from the first scheduling implementation — it is very difficult to fix in production because stored `next_fup_at` values are already wrong.

---

### FUP-04: LLM Call Inside Scheduler Fails Silently — FUP Step Advances Without Message Sent

**Severity:** HIGH

**What goes wrong:** The FUP scheduler calls the LLM to generate a personalized follow-up message, then sends it via the transport (webhook or RabbitMQ). If the LLM call fails (rate limit, timeout, invalid response), but the error is not properly caught, the scheduler may advance the FUP step counter (`status = 'sent'`, `step = step + 1`) without ever actually sending the message. The lead's FUP sequence advances silently — from the system's perspective, FUP step 1 was "sent," but the lead received nothing.

A variant: the LLM call succeeds but the transport send fails. The message was generated but not delivered. Same silent advance problem.

**How to avoid:**
- Use a strict three-phase pattern with explicit success confirmation at each step:
  1. `status = 'in_progress'` (claimed via SKIP LOCKED)
  2. Generate LLM message (can fail — keep status as `in_progress`)
  3. Send via transport (can fail — keep status as `in_progress`)
  4. Only on confirmed send: `status = 'sent'`, advance step, set `next_fup_at` for next step
  5. If any step fails: `status = 'pending'` (ready for retry on next scheduler tick), increment `failure_count`
- After `failure_count >= 3`: `status = 'failed'`, log alert, notify ops — never silently skip
- Never update `status = 'sent'` before the transport confirms delivery (or at minimum, enqueue)
- Add a test that injects an LLM failure (mock) and asserts `status` remains `pending` after the failure, and that `failure_count` increments

**Warning signs:**
- `fup_schedule` shows `status = 'completed'` for leads who report never receiving follow-up messages
- FUP step counter increments but no corresponding outbound message appears in transport logs
- `failure_count` column is always 0 even when LLM errors appear in application logs

**Phase to address:** FUP scheduler phase, during the send-loop implementation. The status update ordering is a correctness constraint, not an optimization.

---

### FUP-05: `leads.last_message_at` Not Updated on Incoming Messages — Scheduler Uses Stale Data

**Severity:** HIGH

**What goes wrong:** The FUP scheduler detects leads who have "gone silent" by comparing `leads.last_message_at` against `NOW() - FUP_TRIGGER_DELAY`. If `last_message_at` is not reliably updated every time a lead sends a message, the scheduler may trigger FUPs for leads who are actively conversing. The lead is mid-conversation when they receive an automated FUP — this is confusing and can damage the SDR relationship.

The existing `leads` table schema does NOT have a `last_message_at` column (only `created_at` and `updated_at`). If `updated_at` is used as a proxy (updated on lead upsert), it is only updated when the lead record changes (e.g., `nome` changes) — not on every incoming message. This means the first-contact upsert sets `updated_at`, and then `updated_at` is never updated again for leads whose `nome` doesn't change.

**How to avoid:**
- Add a `last_message_at TIMESTAMP WITH TIME ZONE` column to the `leads` table (in the v1.4 migration).
- In `LeadService.upsert()` (called at the start of every `BrainRunner.run()` turn), always update `last_message_at = NOW()` regardless of whether other fields changed:
  ```typescript
  await db.update(leads)
    .set({ lastMessageAt: new Date() })
    .where(eq(leads.uniqueId, uniqueId));
  ```
- The FUP scheduler checks: `WHERE last_message_at < NOW() - INTERVAL '$threshold' AND status = 'pending'`.
- Add a test that simulates: lead goes silent → FUP scheduled → lead sends a new message → assert `last_message_at` is updated → assert FUP is cancelled or not re-triggered.

**Warning signs:**
- Leads in active conversation receive automated FUP messages
- `leads.last_message_at` is NULL for leads who have sent multiple messages
- `updated_at` is the same as `created_at` for all leads (upsert is not updating it on message receipt)

**Phase to address:** FUP scheduler phase. The `last_message_at` column and update logic must be in place before the scheduler's "silence detection" query is written.

---

### FUP-06: FUP Fires While Lead Is in Active Conversation — Race Between Scheduler and BrainRunner

**Severity:** HIGH

**What goes wrong:** The FUP scheduler and `BrainRunner.run()` operate concurrently. The scheduler checks `last_message_at` at time T and decides to send a FUP. At time T+50ms, the lead sends a new WhatsApp message. The `BrainRunner` processes the message and updates `last_message_at`. At T+200ms, the FUP is sent to the transport. The lead receives both the Brain's normal reply and the FUP message — two messages from the same agent, one of them out-of-context.

This race cannot be fully eliminated without distributed locking on the lead during both paths (expensive). However, it can be made rare and detectable.

**How to avoid:**
- Implement a "cooling off" check inside the scheduler's SKIP LOCKED transaction: before sending the FUP, re-read `last_message_at` from the DB and abort if it is more recent than when the FUP was scheduled:
  ```typescript
  const lead = await db.select({ lastMessageAt: leads.lastMessageAt })
    .from(leads).where(eq(leads.id, fup.leadId)).limit(1);
  if (lead[0].lastMessageAt > fup.scheduledAt) {
    // Lead is active — cancel this FUP
    await db.update(fupSchedule).set({ status: 'cancelled' }).where(...);
    return;
  }
  ```
- Set the FUP trigger threshold high enough that normal response times don't create races. If the Brain typically responds within 5 seconds, a FUP threshold of 1 hour creates a near-zero race window.
- Log cancelled FUPs (with reason `lead_responded`) — this is useful for monitoring scheduler health.
- Accept that an occasional simultaneous FUP + Brain reply is a known limitation of the design. Document it as a known edge case with low impact (not a data integrity issue, just a UX awkwardness).

**Warning signs:**
- Leads report receiving a FUP message immediately after they send a message (within seconds)
- `fup_schedule` shows `status = 'sent'` for leads whose `last_message_at` is more recent than `fup.sent_at`
- The race appears more frequently when FUP thresholds are very short (seconds) rather than hours

**Phase to address:** FUP scheduler phase. The freshness check must be inside the SKIP LOCKED transaction, not as a separate query before it.

---

### FUP-07: Bun `setInterval` RSS Memory Growth in Long-Running Scheduler

**Severity:** MEDIUM

**What goes wrong:** Bun has documented RSS (Resident Set Size) memory growth when using `setInterval` in long-running processes. GitHub issue #16488 (January 2025) reports heap object count growing with every `setInterval` tick. A follow-up in August 2025 (issue #21560) confirms that RSS climbs from ~110MB to ~150MB over several hours in a child process with only a simple interval. `global.gc()` does not reclaim the RSS growth.

For the FUP scheduler specifically: the scheduler interval function runs an async DB query every 60 seconds. If the query takes longer than 60 seconds (under load or DB slowdown), the next tick starts before the previous one completes — creating overlapping async executions that can compound the memory growth.

**How to avoid:**
- Use a self-scheduling pattern instead of `setInterval` to prevent overlapping executions:
  ```typescript
  async function runSchedulerTick(): Promise<void> {
    try {
      await processPendingFUPs();
    } catch (err) {
      logger.error({ err }, 'FUP scheduler tick failed');
    } finally {
      // Schedule next tick AFTER current tick completes — prevents overlap
      setTimeout(runSchedulerTick, SCHEDULER_INTERVAL_MS);
    }
  }
  runSchedulerTick(); // Start the chain
  ```
- Monitor RSS of the Brain process in production. If it grows more than 50MB over 24 hours, the scheduler is the primary suspect.
- Bun 1.1.13+ (April 2026) included memory fixes — update to the latest Bun version. But do not rely on this as the sole mitigation.
- Do NOT run the FUP scheduler in a Bun Worker thread to "isolate" the memory growth — Bun's worker thread implementation has separate documented issues (SharedArrayBuffer crashes, WASM visibility bugs) that introduce more problems than the memory growth it would solve.

**Warning signs:**
- Brain process RSS grows monotonically over hours without stabilizing
- `bun test` shows increasing heap size in tests that use `setInterval`
- OOMKilled events in Kubernetes for Brain pods after 12-24 hours of uptime

**Phase to address:** FUP scheduler phase. Use the self-scheduling pattern from the first implementation; upgrading to `setInterval` later is a downgrade.

---

### FUP-08: FUP Sequence Not Cancelled When Lead Responds — Stale `pending` Status

**Severity:** HIGH

**What goes wrong:** The FUP scheduler triggers when a lead has not responded. When the lead eventually responds (and `BrainRunner.run()` processes their message), the `fup_schedule` table must be updated to cancel the remaining pending FUP steps. If this cancellation is omitted, the scheduler will continue sending FUPs even after the lead has re-engaged — a confusing experience and a sign of broken state management.

The cancellation must happen in `LeadService` or `BrainRunner.run()` on every incoming message, not just on the first response after a silence period — because the lead might go silent again later, requiring a new FUP sequence.

**How to avoid:**
- In `LeadService.upsert()` (or a new `LeadService.recordIncomingMessage()`), after updating `last_message_at`, cancel all pending FUP steps for this lead:
  ```typescript
  await db.update(fupSchedule)
    .set({ status: 'cancelled', cancelReason: 'lead_responded' })
    .where(and(
      eq(fupSchedule.leadId, lead.id),
      eq(fupSchedule.status, 'pending')
    ));
  ```
- This is a standard UPDATE — no locking needed (the scheduler's SKIP LOCKED won't claim cancelled rows).
- If a new FUP sequence should start from step 1 the next time the lead goes silent, create a new `fup_schedule` row on cancellation (or let the scheduler create it when silence is detected again).
- Add a test: lead goes silent → FUP step 1 is sent → lead responds → assert remaining FUP steps are cancelled → assert no further FUP messages are sent.

**Warning signs:**
- Leads who responded to a FUP receive additional FUP messages in subsequent days
- `fup_schedule` table has rows with `status = 'pending'` and `next_fup_at` in the past for leads who recently responded
- `last_message_at` is recent but `fup_schedule.status = 'pending'` (the two are inconsistent)

**Phase to address:** FUP scheduler phase, specifically when integrating with `LeadService`. The cancellation must be in the same code path as `last_message_at` update.

---

## Phase-Specific Warnings (v1.4)

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|------------|
| RAG ingestion | Embedding model | RAG-01: Model change corrupts all existing embeddings silently | Store `embedding_model` per row; startup assertion compares env to DB |
| RAG ingestion | Embedding model | RAG-02: Dimension mismatch between model output and pgvector column | Startup assertion: embed test string, assert `length === EMBEDDING_DIMENSIONS` |
| RAG ingestion | pgvector | RAG-03: HNSW recall degradation with collection filter (pre-filter problem) | Set `hnsw.iterative_scan = relaxed_order` in query; or partial index per collection |
| RAG ingestion | Chunking | RAG-04: Too-small chunks lose context; too-large chunks dilute signal | `RecursiveCharacterTextSplitter` with `chunkSize: 512`, `chunkOverlap: 50` |
| RAG ingestion | Bun compat | RAG-05: tiktoken WASM fails in Bun — native module error at first ingest | Use character-based `RecursiveCharacterTextSplitter`; avoid `TokenTextSplitter` |
| Tool Events | Publisher | EVT-01: Publisher blocks LangGraph flow if awaited | Fire-and-forget: `void publisher.publish(...).catch(...)` — never await |
| Tool Events | Context | EVT-02: Lead data unavailable in tool closure — requires threading | Pass `lead` object into tool factory at `BrainRunner.run()` time |
| Tool Events | RabbitMQ | EVT-03: Publish to undefined queue silently drops events | Startup validation of `TOOL_EVENTS_QUEUE`; `confirm: true` on publisher |
| Tool Events | Architecture | EVT-04: Circular dependency `transport → events → transport` | Separate `packages/events` package; never import transport from events |
| Tool Events | LangGraph | EVT-05: Tool re-execution on resume causes duplicate events | Include `tool_call_id`-derived `event_id`; document at-least-once guarantee |
| FUP Scheduler | Distributed | FUP-01: Multiple instances double-send same FUP | `SELECT ... FOR UPDATE SKIP LOCKED` pattern — claim before send |
| FUP Scheduler | Persistence | FUP-02: In-memory scheduler state lost on process restart | All FUP state in DB `fup_schedule` table; poll-not-setTimeout-per-lead |
| FUP Scheduler | Timezone | FUP-03: DST transition fires FUP at wrong hour or skips it | Store UTC timestamps; compute with `date-fns-tz`; avoid naive offset arithmetic |
| FUP Scheduler | Reliability | FUP-04: LLM failure silently advances FUP step | Status only updates to `sent` after confirmed transport delivery |
| FUP Scheduler | Lead state | FUP-05: `last_message_at` not updated on incoming messages | Add column to `leads`; update in `LeadService.upsert()` on every incoming message |
| FUP Scheduler | Race | FUP-06: FUP fires during active conversation | Freshness re-check inside SKIP LOCKED transaction; cancel if lead recently responded |
| FUP Scheduler | Bun | FUP-07: `setInterval` RSS memory growth in Bun long-running process | Self-scheduling pattern with `setTimeout` chain; avoid `setInterval` |
| FUP Scheduler | State | FUP-08: FUP sequence not cancelled when lead responds | Cancel `pending` FUPs in `LeadService` on every incoming message |

---

### v1.4 Sources

- Embedding drift production pitfalls: [Embedding Drift: The Quiet Killer of Retrieval Quality in RAG Systems](https://medium.com/@anindyasinghobi/embedding-drift-the-quiet-killer-of-retrieval-quality-in-rag-systems-b5d46bee3bba)
- Embedding models versioning and index drift (April 2026): [Embedding Models in Production: Selection, Versioning, and the Index Drift Problem](https://tianpan.co/blog/2026-04-09-embedding-models-production-versioning-index-drift)
- 4 pgvector production mistakes: [4 pgvector Mistakes That Silently Break Your RAG Pipeline in Production](https://dev.to/mianzubair/4-pgvector-mistakes-that-silently-break-your-rag-pipeline-in-production-4e0p)
- pgvector HNSW pre-filtering reduced ANN recall: [No pre-filtering in pgvector means reduced ANN recall](https://dev.to/mongodb/no-pre-filtering-in-pgvector-means-reduced-ann-recall-1aa1)
- pgvector 0.8.0 iterative index scan: [pgvector 0.8.0 Released](https://www.postgresql.org/about/news/pgvector-080-released-2952/)
- pgvector 0.8.0 iterative scan on Aurora (AWS): [Supercharging vector search performance with pgvector 0.8.0](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/)
- pgvector DBA guide indexes (March 2026): [pgvector, a guide for DBA - Part 2: Indexes](https://www.dbi-services.com/blog/pgvector-a-guide-for-dba-part-2-indexes-update-march-2026/)
- pgvector dimension mismatch solved (2026): [pgvector Dimension Mismatch, Casting & ALTER TABLE: Solved](https://dbadataverse.com/tech/postgresql/2026/05/pgvector-gotchas-dimension-mismatch-casting-errors-and-alter-table-solved-2026)
- RAG chunking pitfalls production 2026: [Chunking Strategy for RAG Systems: A Technical Implementation Guide](https://www.unsiloed.ai/blog/chunking-strategy-rag-systems-technical-implementation-guide)
- RAG chunking 2026 benchmarks: [RAG Chunking Strategies: The Visual Guide (2026 Benchmarks)](https://aiagentsbuzz.com/guides/rag-chunking-strategies/)
- tiktoken Bun/Lambda compatibility issue: [Error with @dqbd/tiktoken on Lambda Node.js 18.x](https://github.com/hwchase17/langchainjs/issues/665)
- PostgreSQL SKIP LOCKED for distributed job scheduling: [Lightweight Distributed Locks with PostgreSQL: Skip Locked in Action](https://medium.com/@arkadii.osheev.official/lightweight-distributed-locks-with-postgresql-skip-locked-in-action-2461a067b491)
- Preventing duplicate cron in scaled environments: [Preventing Duplicate Cron Job Execution in Scaled Environments](https://medium.com/@WMRayan/preventing-duplicate-cron-job-execution-in-scaled-environments-52ab0a13f258)
- Advisory lock PgBouncer incompatibility (SKIP LOCKED as alternative): [Postgres distributed lock using PgBouncer connection pooler](https://github.com/madelson/DistributedLock/issues/168)
- DST timezone bugs in cron (2025 guide): [Handling Timezone Issues in Cron Jobs (2025 Guide)](https://dev.to/cronmonitor/handling-timezone-issues-in-cron-jobs-2025-guide-52ii)
- node-cron vs Croner timezone handling 2026: [node-cron vs node-schedule vs Croner 2026](https://www.pkgpulse.com/guides/node-cron-vs-node-schedule-vs-croner-task-scheduling-2026)
- Bun setInterval memory leak (issue #16488): [Memory Leak setInterval - Bun GitHub](https://github.com/oven-sh/bun/issues/16488)
- Bun RSS growth in child process with interval (issue #21560): [Memory (RSS) in Bun Spawned Child Process Grows Slowly](https://github.com/oven-sh/bun/issues/21560)
- Bun SharedArrayBuffer worker crash (issue #15787): [Bun crashes when passing SharedArrayBuffer via BroadcastChannel](https://github.com/oven-sh/bun/issues/15787)
- Bun 1.1.13 memory fixes (April 2026): [Bun 1.1.13 out with memory fixes](https://www.theregister.com/software/2026/04/21/bun-1113-out-with-memory-fixes-as-dev-complain-of-leaks/5221154)
- RabbitMQ publish to undefined queue silent drop: [How to Fix 'Queue Not Found' Errors in RabbitMQ](https://oneuptime.com/blog/post/2026-01-24-fix-rabbitmq-queue-not-found/view)
- LangGraph tool re-execution on resume: [Fault Tolerance in LangGraph: Retries, Timeouts and Error Handlers](https://www.langchain.com/blog/fault-tolerance-in-langgraph)
- Multi-tenant RAG approaches with pgvector: [Building Multi-Tenant RAG Applications With PostgreSQL](https://www.tigerdata.com/blog/building-multi-tenant-rag-applications-with-postgresql-choosing-the-right-approach)

---
*v1.4 addendum researched: 2026-06-23*
