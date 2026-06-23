# Feature Research: Brain Core v1.4

**Domain:** RAG + Tool Event Publishing + Automated Follow-Up for AI agent platform (Bun + LangGraph + pgvector)
**Researched:** 2026-06-23
**Scope:** v1.4 new features only. All v1.0–v1.3 infrastructure (BrainRunner, BrainOutput, ToolsRegistry, transport, LangGraph graph, PostgresSaver, MCP integration) is already built and must not be re-implemented.
**Overall confidence:** HIGH (verified via official LangChain.js docs, pgvector docs, chunking research, production RAG guides, multiple cross-checked sources)

---

## Feature 1: RAG — Knowledge Ingest + Search

### Table Stakes (must-have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **POST /api/v1/ingest endpoint** | RAG requires an ingest surface. Text enters through an HTTP endpoint — not pre-loaded files or CLI scripts. Clients (n8n workflows, CRMs) call this endpoint to populate a Brain's knowledge base. | Low | Hono route. Accepts `{ collection_name, text, metadata? }`. Returns `{ chunks_created: N }`. Authentication left to API gateway (out of scope for v1.4). |
| **Recursive text splitting (chunk_size ≈ 512 tokens, overlap ≈ 64 tokens)** | Recursive splitting is the correct default for 80% of use cases — it respects paragraph → sentence → word boundaries, producing semantically complete chunks. Fixed-size splitting ignores structure and frequently cuts mid-sentence. | Low | Implement in `packages/rag` using separator hierarchy `["\n\n", "\n", ". ", " ", ""]`. Chunk size 512 tokens (~2KB text), overlap 64 tokens (~12.5%). No external library needed — pure string logic. |
| **Embedding generation per chunk** | Each chunk must be converted to a vector via an embedding model before storage. Embedding is the prerequisite for semantic search. | Low | Use LangChain's `OpenAIEmbeddings` (text-embedding-3-small, 1536 dims) or `@langchain/community` provider alternatives. Configurable via `EMBEDDING_MODEL` ENV. Batch chunks to reduce API round-trips. |
| **`embeddings` table in pgvector with `collection_name` column** | Collection isolation is required so different Brains or use cases (e.g., "product_catalog", "support_faq") share one table without cross-contamination in search results. Row-level filtering by `collection_name` is the standard pattern — it avoids schema proliferation and works natively with Drizzle WHERE clauses + pgvector iterative HNSW scans. | Low | Schema: `id BIGSERIAL PK, collection_name TEXT NOT NULL, source TEXT, chunk_idx INT, content TEXT, embedding VECTOR(1536), metadata JSONB, created_at TIMESTAMPTZ`. HNSW index with `m=16, ef_construction=64`. |
| **`search_knowledge` tool available to all Brains** | The LLM must be able to trigger knowledge retrieval during a conversation. A LangGraph `StructuredTool` registered in `ToolsRegistry` is the correct integration point — same pattern as `qualify_lead`, `pause_session`, `finish_conversation`. | Medium | Tool signature: `{ query: string, collection_name: string, top_k?: number }`. Returns array of `{ content, source, score }`. LLM formats into response. Register via `enableTool("sdr", "search_knowledge")`. |
| **Cosine similarity search with collection filter** | Semantic search must filter by `collection_name` before ranking. pgvector 0.8.x supports iterative HNSW scans with WHERE clauses — no full-table scan. Distance metric: cosine (`<=>` operator). | Low | Query pattern: `SELECT content, source, 1 - (embedding <=> $query_vec) AS score FROM embeddings WHERE collection_name = $name ORDER BY embedding <=> $query_vec LIMIT $k`. Score threshold: reject chunks with `score < 0.60`. |
| **Context injection into LLM prompt** | Retrieved chunks must be formatted and inserted into the LLM's context window. Raw chunk dumps confuse the model — structured framing ("Based on the following knowledge base entries:…") improves generation quality. | Low | Format: numbered list with source attribution. Cap total context at ~2000 tokens (top 3–5 chunks at 512 tokens each). The `search_knowledge` tool returns formatted text ready for prompt injection. |

### Differentiators (nice-to-have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`metadata` JSONB column per chunk** | Enables future filtering by document type, date, author, or custom tags without schema changes. A `metadata` column costs nothing at ingest time and avoids a future migration. | Low | Store at ingest: `{ source_url, document_type, ingested_at }`. Not queried in v1.4 — reserved for future hybrid filtering. |
| **Duplicate chunk prevention on re-ingest** | Re-ingesting the same text (document update) should not create duplicate embeddings. Without deduplication, vector count grows unbounded and retrieval quality degrades over time. | Medium | Strategy: hash `collection_name + content` into a `content_hash` column (UNIQUE constraint). On conflict: update `metadata`, skip re-embedding. Avoids full re-index on minor edits. |
| **Configurable `top_k` and score threshold per tool call** | Different Brain prompts need different retrieval depth. An SDR querying "product pricing" may need top 3 chunks; a support Brain answering "how do I configure X" may need top 5. | Low | `top_k` defaults to 5. Score threshold defaults to 0.60. Both overridable via tool input schema. |

### Anti-Features (what NOT to build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Semantic chunking (embedding-based split points)** | Semantic chunking computes embeddings at every sentence boundary to find split points — extremely expensive at ingest time and the marginal retrieval improvement (up to 9%) does not justify the cost for the use cases in scope (product FAQs, support docs). A January 2026 analysis found overlap provided no measurable benefit for SPLADE retrieval. | Use recursive character splitting at 512 tokens. It produces 88–89% recall on standard benchmarks and runs in-process without embedding API calls during split computation. |
| **Separate vector database (Pinecone, Qdrant, Weaviate)** | Brain Core already runs PostgreSQL with pgvector. Adding a separate vector DB introduces a new infrastructure dependency per client deployment, increases operational cost, and provides no benefit at Brain-scale (thousands to low millions of vectors). | Use pgvector in existing PG instance. HNSW indexing handles sub-100ms queries at millions of vectors. |
| **PDF, DOCX, HTML parsing in the ingest endpoint** | Binary document parsing is a separate concern. The ingest endpoint accepting raw text only keeps scope bounded and the endpoint simple. Document parsing belongs upstream (n8n workflow, a preprocessing step). | Accept `text` string only at POST /api/v1/ingest. Document parsing is the caller's responsibility. |
| **Streaming ingest response (SSE or chunked)** | Large documents (>100KB) split into many chunks may take a few seconds to process. Streaming progress is unnecessary complexity for a background operation — a simple sync response with `{ chunks_created: N }` is sufficient. | Sync HTTP response. If ingest becomes a bottleneck, move to async (return job ID) in a future milestone. |
| **Per-Brain vector tables (one table per Brain type)** | Separate tables (`sdr_embeddings`, `support_embeddings`) require schema migrations for each new Brain type and prevent shared knowledge between Brains in the same tenant. | Use single `embeddings` table with `collection_name` column. Brain SDR uses `collection_name = "sdr_knowledge"`. Any Brain can query any collection. |
| **Re-ranking with a cross-encoder model** | Cross-encoders improve retrieval precision significantly but require a dedicated ML model (hosted inference or local), adding infrastructure complexity. This is a v2+ optimization. | Use cosine similarity with score threshold (0.60) as the primary filter. Sufficient for v1.4. |

---

## Feature 2: Tool Events — Outbound Notifications

### Table Stakes (must-have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Fire-and-forget event emission on tool completion** | External systems (n8n, CRM, dashboards) need to react to Brain tool results without polling. When `qualify_lead` completes, an n8n workflow should receive `{ action: "qualify_lead", lead: {...}, result: {...} }` immediately. "Fire-and-forget" means the Brain does not wait for the external system's response — tool execution continues regardless. | Medium | Pattern: `setImmediate(() => eventPublisher.publish(event))` — non-blocking, decoupled from tool return path. Event failures are logged (Pino) but do not throw. |
| **`BaseCallbackHandler.handleToolEnd()` as the integration point** | LangChain's `BaseCallbackHandler` fires `handleToolEnd(output, runId)` when any tool completes. This is the clean, framework-native hook — no modification to individual tool implementations required. The callback receives the tool name, tool output, and run metadata. Any new tool added to the graph is automatically covered. | Low | Extend `BaseCallbackHandler`, override `handleToolEnd`. Pass the handler via `{ callbacks: [handler] }` in `graph.invoke()`. Works with all tools: `qualify_lead`, `pause_session`, `finish_conversation`, MCP tools, `search_knowledge`. |
| **Event payload schema: `{ action, lead, result, timestamp }`** | A structured, versioned payload is required for downstream consumers to reliably parse events. Unstructured strings or raw tool output are not consumable by n8n or CRM integrations without brittle parsing. | Low | `{ action: string, lead: { id, unique_id, numero, nome }, result: unknown, timestamp: string (ISO8601), brain_type: string }`. `result` is the raw tool return value (already JSON-serializable — StructuredTool always returns string or object). |
| **Transport selection via ENV (`EVENT_TRANSPORT`)** | Tool events are outbound — different from the inbound transport (webhook or RabbitMQ). The event destination may be a different RabbitMQ exchange or a separate webhook endpoint. Controlled by `EVENT_TRANSPORT=webhook|rabbitmq` and `EVENT_WEBHOOK_URL` or `EVENT_RABBITMQ_EXCHANGE` ENVs. | Low | Reuse existing transport pattern (`packages/transport`). Add `EventPublisher` class with `publish(event)` method. Decouple from `BrainRunner` inbound transport — they are independent. |
| **Thread ID (lead context) passed to callback handler** | The callback only receives the tool output and run metadata — not the lead context. The `thread_id` (= `lead.unique_id`) must be threaded into the callback handler at request time so the event payload can include lead information. | Low | Pattern: create a new handler instance per `graph.invoke()` call, passing the lead context in the constructor. Each invocation gets its own handler with the correct lead context. |

### Differentiators (nice-to-have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Tool-level event filtering via `EVENT_TOOLS` ENV** | Some tools should not emit events (e.g., `search_knowledge` is internal retrieval, not a business action). Filtering prevents downstream systems from being flooded with irrelevant events. | Low | `EVENT_TOOLS=qualify_lead,finish_conversation` CSV. In `handleToolEnd`, check `toolName` against allowlist. Default: emit for all tools. |
| **Event batching with a small buffer (100ms)** | High-traffic Brains may call multiple tools per turn. Batching avoids N individual HTTP calls per turn. | Medium | Complex to implement correctly without losing fire-and-forget semantics. Defer to a future milestone unless throughput becomes an issue. |

### Anti-Features (what NOT to build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Modifying each tool's `_call()` method to emit events** | Per-tool event emission requires every tool (existing and future) to know about the event publisher. This couples tools to transport, violates single responsibility, and creates maintenance debt — new tools must remember to emit. | Use `BaseCallbackHandler.handleToolEnd()`. The callback is graph-wide and covers all tools without tool-level awareness. |
| **Storing tool events in a DB table** | A `tool_events` table would duplicate the LangGraph checkpoint (which already stores all `ToolMessage` entries) and add a write failure mode on every tool call. Downstream systems can query the LangGraph checkpoint directly if persistence is needed. | Fire-and-forget to external transport. If persistence is required, the external system (n8n, CRM) stores the event in its own persistence layer. |
| **Synchronous event publication (blocking tool return)** | Waiting for the external system to acknowledge the event before the tool returns adds latency to every tool call and creates a coupling — if the event endpoint is slow, the LLM response is delayed. | Non-blocking: `setImmediate` or `void publisher.publish(event).catch(logger.error)`. The tool return path is independent. |
| **Event acknowledgment / retry logic with exponential backoff** | Retry logic with state (attempts, last_error, next_retry) requires a persistent job queue. This is significant complexity for a "best-effort notification" feature. | Best-effort: one attempt, log failures. If delivery guarantees are required, use RabbitMQ with durable queues — the broker handles retries. |
| **Separate HTTP server for event publishing** | Adding a new server process or port for event delivery increases deployment complexity (another container, port mapping, network policy). | Publish from within the Brain process using existing transport infrastructure (`packages/transport`). |

---

## Feature 3: FUP Automático — Automated Follow-Up

### Table Stakes (must-have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`lead_fups` table tracking FUP state per lead** | The scheduler needs persistent state to know which leads are awaiting follow-up, what step they are on, when to send the next one, and when to stop. In-memory state is lost on container restart. | Low | Schema: `id BIGSERIAL PK, lead_id INT FK(leads.id), fup_step INT DEFAULT 0, next_fup_at TIMESTAMPTZ, fup_enabled BOOL DEFAULT true, last_sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ`. Separate table from `leads` — respects single responsibility and avoids further bloating the leads table. |
| **FUP state machine with 4 states** | A clear state machine prevents ambiguous transitions and simplifies scheduler logic. States: `PENDING` (registered, waiting for first send), `IN_PROGRESS` (at least one message sent, waiting for next interval), `COMPLETED` (last step sent, ia_ativada disabled), `DISABLED` (lead replied or manually disabled — no more FUPs). | Low | State is derived from `fup_enabled` + `fup_step` + `last_sent_at` rather than a stored enum — this avoids an extra column. Scheduler query: `WHERE fup_enabled = true AND next_fup_at <= NOW()`. |
| **Background polling loop (setInterval, configurable tick)** | A simple `setInterval` loop that queries `lead_fups WHERE fup_enabled = true AND next_fup_at <= NOW()` is sufficient for the scale of a single Brain instance. No external job queue needed. | Medium | Tick interval: configurable via `FUP_POLL_INTERVAL_MS` ENV (default: 30000ms = 30s). Loop runs in the same Bun process as the Brain. Uses `postgres.js` directly (not LangGraph) to avoid LangGraph state overhead for scheduling queries. |
| **Business hours and allowed days enforcement** | Sending follow-ups at 3am or on Sunday creates a negative experience and may violate WhatsApp Business policies. The scheduler must check whether the current time in the configured timezone falls within the allowed window before sending. | Medium | Config (ENV or DB): `FUP_START_HOUR=9`, `FUP_END_HOUR=18`, `FUP_ALLOWED_DAYS=1,2,3,4,5` (1=Monday), `FUP_TIMEZONE=America/Sao_Paulo`. Use `luxon` for timezone arithmetic: `DateTime.now().setZone(timezone).hour`. |
| **Luxon for timezone handling** | Brazil (São Paulo) suspended DST in 2019 — but IANA tzdata must be the source of truth since DST policy can change. Luxon uses IANA zones correctly, handles DST automatically, and is more ergonomic than `date-fns-tz` for scheduling-heavy logic. | Low | `npm install luxon`. Use `DateTime.now().setZone("America/Sao_Paulo")` for "is it business hours?" check. Store all timestamps as UTC (`TIMESTAMPTZ`) in the DB — convert to local only for the business hours gate. |
| **LLM-generated personalized FUP message** | The message sent to a silent lead must reference the conversation history for personalization. A static template ("Hi, just checking in!") has low engagement; an LLM-generated message using the lead's actual conversation context is more effective. | Medium | Pattern: retrieve the last N messages from PostgresSaver (via `checkpointer.getTuple(thread_id)`), pass them + the FUP prompt (from DB `prompts` table) to the LLM, generate a message. This is a one-shot LLM call — not a full LangGraph turn — to keep FUP generation fast. |
| **FUP sequence configuration (steps, intervals)** | Different clients need different sequences. Intervals must be configurable in seconds (as specified in requirements) — not just human-readable strings. DB-driven config is preferable over ENV so it can be changed without redeployment. | Medium | `fup_configs` table: `id, brain_type, step_number, interval_seconds, is_last_step`. Scheduler reads this table at startup and caches. Example: step 1 = 3600s (1h), step 2 = 86400s (24h), step 3 = 259200s (72h, last). |
| **Disable `ia_ativada` and FUP on last step** | The requirements specify that the last FUP must disable `ia_ativada` and `fup_enabled`. Without this, the scheduler would keep trying after all steps are exhausted. | Low | On last step send: `UPDATE leads SET ia_ativada = false WHERE id = $lead_id` + `UPDATE lead_fups SET fup_enabled = false WHERE lead_id = $lead_id`. Wrapped in a transaction. |
| **Disable FUP when lead replies** | If a lead replies after receiving a FUP, the FUP sequence should stop — the lead is no longer silent. This is the core "FUP disabled" trigger. | Low | In `BrainRunner.run()` (already called on every inbound message): check if `lead_fups.fup_enabled = true` for this lead, if so set `fup_enabled = false` (or reset sequence). This is a simple UPDATE on every inbound message for leads with active FUPs. |
| **Send FUP via existing transport** | FUP messages must be sent through the same channel (WhatsApp via webhook/RabbitMQ) as normal Brain responses. Reusing the existing `TransportPublisher` avoids duplicating send logic. | Low | The scheduler calls `transport.send({ to: lead.numero, message: fupMessage })`. The transport abstraction (`packages/transport`) already supports this — same interface used by `BrainRunner`. |

### Differentiators (nice-to-have)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **`fup_logs` table for audit trail** | Records every FUP sent: `lead_id, step, sent_at, message_preview, delivery_status`. Enables debugging failed sequences and analyzing engagement. | Low | Not required for v1.4 MVP — add if client requests delivery tracking. |
| **FUP pause/resume API** | `POST /api/v1/leads/:id/fup/pause` and `/resume` for manual control from n8n without direct DB access. | Medium | Useful for sales ops but not required for the automated flow. Defer post v1.4. |
| **Configurable per-lead FUP intervals** | Override global sequence timing for specific leads (e.g., high-value lead gets a shorter re-contact window). | High | Complex — adds a `lead_fup_overrides` table and override resolution logic. Not in scope for v1.4. |

### Anti-Features (what NOT to build)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full LangGraph turn for FUP message generation** | Running a full `graph.invoke()` for each FUP (with tool calls, PostgresSaver state writes, routing logic) is expensive and slow. FUP generation is a simple one-shot prompt — it does not need the full agent machinery. | One-shot LLM call with conversation history context. No ToolNode, no LangGraph state transition. |
| **External job queue (BullMQ + Redis, pg_boss)** | Adds a new infrastructure dependency (Redis or separate PG schema). The volume of FUPs per Brain instance is low (hundreds of leads, not millions). A `setInterval` loop with a DB query is sufficient and zero-dependency. | `setInterval` loop polling `lead_fups WHERE next_fup_at <= NOW()`. Add a dedicated job queue only if FUP volume exceeds ~10,000 concurrent leads per instance. |
| **`pg_cron` for FUP scheduling** | `pg_cron` is a PostgreSQL extension that may not be available in client PG instances (especially managed PG like RDS, Supabase). It also requires extension installation privileges. | In-process `setInterval` in the Bun runtime. No external PG extension needed. |
| **FUP logic inside LangGraph nodes** | Routing FUP generation through graph nodes couples the FUP scheduler to the conversation graph, making both harder to maintain. FUP is a scheduled background process, not a conversation turn. | FUP scheduler is a standalone service/class in `packages/fup` or `packages/core`, independent of the LangGraph graph. |
| **WhatsApp-level FUP scheduling (delay send)** | Some WhatsApp APIs support scheduled message delivery. Relying on WhatsApp scheduling creates vendor lock-in and removes control over business hours enforcement. | Control scheduling in the Brain. Send the message immediately when the scheduler fires (after business hours gate passes). |
| **Exponential backoff on FUP send failure** | If the transport fails to send a FUP (RabbitMQ down, webhook timeout), retrying with backoff is complex state to manage. For a best-effort FUP system, one retry is sufficient — if it fails, the scheduler will try again on the next poll tick. | Catch transport errors in the scheduler loop, log with Pino, and update `next_fup_at` to `NOW() + retry_delay` (e.g., 5 minutes). Simple and recoverable. |

---

## Feature Dependencies

```
RAG:
  POST /api/v1/ingest
    └── requires ── packages/rag (new shared package: chunker + embedder + db write)
    └── requires ── embeddings table (new migration)
    └── requires ── EMBEDDING_MODEL + OPENAI_API_KEY ENVs

  search_knowledge tool
    └── requires ── packages/rag (query function)
    └── requires ── embeddings table
    └── requires ── ToolsRegistry.enableTool("sdr", "search_knowledge")
    └── enhances ── Brain SDR (LLM can answer from knowledge base)

Tool Events:
  BaseCallbackHandler subclass (ToolEventPublisher)
    └── requires ── packages/transport (EventPublisher wraps existing transport)
    └── requires ── EVENT_TRANSPORT + EVENT_WEBHOOK_URL or EVENT_RABBITMQ_EXCHANGE ENVs
    └── thread_id context ── lead available in BrainRunner.run() (already present)
    └── integrates ── graph.invoke({ callbacks: [handler] }) — existing invocation point

FUP Automático:
  Scheduler loop
    └── requires ── lead_fups table (new migration)
    └── requires ── fup_configs table (new migration)
    └── requires ── leads table (existing — for numero, ia_ativada)
    └── requires ── PostgresSaver (existing — for conversation history retrieval)
    └── requires ── transport (existing — for sending FUP messages)
    └── requires ── LLM (one-shot call for message generation)
    └── requires ── luxon (new dependency — timezone arithmetic)

  FUP disable-on-reply
    └── requires ── BrainRunner.run() (existing — add UPDATE on inbound message)
    └── requires ── lead_fups table

Cross-feature:
  search_knowledge tool ──triggers──> Tool Events (handleToolEnd fires for search_knowledge)
  FUP message generation ──reads──> RAG (FUP prompt could search knowledge base for context)
  FUP disable ──writes──> leads.ia_ativada (existing column)
```

### Dependency Notes

- **RAG table must exist before `search_knowledge` tool is enabled** — migration order: embeddings table first, then tool registration.
- **Tool Events require no DB migration** — purely runtime: ENV config + callback handler.
- **FUP requires 2 new tables** (`lead_fups`, `fup_configs`) — both added in a single migration.
- **FUP reads `leads.ia_ativada`** (existing) and `lead_fups.fup_enabled` (new) — separate columns, different semantics: `ia_ativada` gates all AI responses; `fup_enabled` gates only the FUP scheduler.
- **Tool Events are independent of RAG and FUP** — can be built and shipped as a standalone phase.
- **RAG and FUP are independent of each other** — RAG does not require FUP and vice versa. However, the FUP message generator can optionally query the knowledge base via `search_knowledge` for richer personalization.

---

## FUP State Machine

```
Lead first contact received
        │
        ▼
   [PENDING] ── fup_enabled=true, fup_step=0, next_fup_at=NOW()+interval[0]
        │
  (next_fup_at reached AND business hours AND fup_enabled=true)
        │
        ▼
  Send FUP message (LLM-generated)
  fup_step += 1
  last_sent_at = NOW()
        │
        ├── (is_last_step = false) → next_fup_at = NOW()+interval[step]
        │         │
        │         ▼
        │   [IN_PROGRESS] ── waiting for next interval
        │         │
        │    (lead replies) ─────────────────────────────────────────┐
        │         │                                                    │
        │   (next_fup_at reached AND in window)                       │
        │         │                                                    │
        │    (loop continues)                                          │
        │                                                             ▼
        └── (is_last_step = true) → fup_enabled=false          [DISABLED]
                  ia_ativada=false                     fup_enabled=false
                  │                                    (lead replied — stop FUP,
                  ▼                                     but ia_ativada stays true)
           [COMPLETED]
           fup_enabled=false
           ia_ativada=false
```

**State derivation (no stored state enum):**
- `PENDING`: `fup_enabled=true AND fup_step=0 AND last_sent_at IS NULL`
- `IN_PROGRESS`: `fup_enabled=true AND fup_step > 0`
- `COMPLETED`: `fup_enabled=false AND last_sent_at IS NOT NULL AND ia_ativada=false`
- `DISABLED`: `fup_enabled=false AND ia_ativada=true` (lead replied)

---

## MVP Definition for v1.4

### Build in v1.4

- [ ] **RAG ingest endpoint** (POST /api/v1/ingest) — text chunking + embedding + pgvector storage
- [ ] **`search_knowledge` tool** — cosine similarity search with `collection_name` filter + context formatting
- [ ] **Tool Events via `BaseCallbackHandler`** — handleToolEnd fires structured event to webhook or RabbitMQ
- [ ] **`lead_fups` + `fup_configs` migration** — persistent FUP state
- [ ] **FUP scheduler** — `setInterval` loop, business hours gate (luxon), LLM message generation, transport send
- [ ] **FUP disable on reply** — UPDATE `lead_fups.fup_enabled=false` when lead sends any inbound message

### Defer (v1.5+)

- [ ] **RAG duplicate prevention** — content_hash deduplication: useful but adds complexity; not blocking for initial knowledge base
- [ ] **Tool Events batching** — only needed at high throughput (>50 tool calls/minute per Brain)
- [ ] **FUP audit log table** — add when clients request delivery reporting
- [ ] **FUP pause/resume API** — add when operational teams need manual control
- [ ] **Cross-encoder re-ranking for RAG** — v2+ optimization once baseline RAG quality is measured

---

## Feature Complexity Summary

| Feature | Sub-Feature | Complexity | Primary Risk |
|---------|-------------|------------|--------------|
| RAG | Chunker implementation | LOW | None — pure string logic |
| RAG | Embedding API integration | LOW | Rate limits on bulk ingest; batch calls |
| RAG | pgvector schema + HNSW index | LOW | Dimension mismatch if embedding model changes |
| RAG | `search_knowledge` tool + score threshold | LOW | Threshold tuning (start at 0.60, adjust) |
| RAG | Context formatting for LLM | LOW | None |
| Tool Events | `BaseCallbackHandler` subclass | LOW | `handleToolEnd` may not fire for all tool types — verify with MCP tools |
| Tool Events | Lead context threading into callback | LOW | Must pass lead per-invocation, not per-Brain |
| Tool Events | Transport publisher (fire-and-forget) | LOW | Error handling: log and continue, never throw |
| FUP | DB schema (`lead_fups`, `fup_configs`) | LOW | None |
| FUP | Scheduler loop + business hours gate | MEDIUM | Clock drift; Bun `setInterval` vs process restarts |
| FUP | Luxon timezone enforcement | LOW | Brazil DST suspension (no DST since 2019 — but use IANA zone anyway) |
| FUP | LLM message generation (one-shot) | MEDIUM | Conversation history retrieval from PostgresSaver (existing API) |
| FUP | Transport send for FUP messages | LOW | Reuse existing transport interface |
| FUP | Disable on lead reply | LOW | Single UPDATE in BrainRunner.run() |
| **v1.4 total** | | **MEDIUM** | FUP scheduler concurrency if multiple Brain instances race to send same FUP |

**Multi-instance FUP race condition:** If a client runs 3 Brain instances (all polling the same DB), all 3 may try to send the same FUP simultaneously. Mitigation: use `SELECT ... FOR UPDATE SKIP LOCKED` in the scheduler query — only one instance acquires the row lock and sends; others skip. This is a known pattern for Postgres-based job queues and requires no external coordinator.

---

## Sources

- [Best Chunking Strategies for RAG 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- [RAG with pgvector TypeScript pipeline 2026 (DEV Community)](https://dev.to/thegdsks/rag-with-postgres-pgvector-in-2026-the-full-typescript-pipeline-2lbd)
- [Build RAG pipeline with TypeScript + PostgreSQL (Encore)](https://encore.dev/articles/how-to-build-rag-pipeline)
- [pgvector collection isolation — multi-tenant RAG (Nile)](https://www.thenile.dev/blog/multi-tenant-rag)
- [Drizzle ORM vector similarity search with pgvector](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [pgvector-node GitHub (Bun support)](https://github.com/pgvector/pgvector-node)
- [RAG score threshold understanding (Nick Berens)](https://nickberens.me/blog/understanding-rag-score-thresholds/)
- [Chunking strategies comparison — Weaviate](https://weaviate.io/blog/chunking-strategies-for-rag)
- [BaseCallbackHandler LangChain.js reference](https://reference.langchain.com/javascript/langchain-core/callbacks/base/BaseCallbackHandler)
- [LangChain callbacks guide (js.langchain.com)](https://js.langchain.com/docs/how_to/custom_callbacks/)
- [LangChain callbacks 2026 — FutureAGI](https://futureagi.com/blog/understanding-langchain-callback-how-to-use-it-effectively/)
- [node-cron timezone support (npm)](https://www.npmjs.com/package/node-cron)
- [Cron and Timezones: UTC, DST Pitfalls (CronBase)](https://cronbase.dev/guides/cron-timezone-guide/)
- [date-fns vs Luxon 2026 comparison (PkgPulse)](https://www.pkgpulse.com/blog/best-javascript-date-libraries-2026)
- [Luxon timezone handling guide (This Dot Labs)](https://www.thisdot.co/blog/how-to-handle-time-zones-using-datetime-and-luxon)
- [SELECT FOR UPDATE SKIP LOCKED — Postgres job queue pattern (Railway)](https://docs.railway.com/guides/cron-workers-queues)

---
*Feature research for: Brain Core v1.4 — RAG + Tool Events + FUP Automático*
*Researched: 2026-06-23*
