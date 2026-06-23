# Research Summary — Brain Core v1.4: RAG + Tool Events + FUP Automático

**Project:** Brain Core v1.4
**Domain:** AI agent platform — incremental milestone (RAG, outbound events, follow-up scheduler)
**Researched:** 2026-06-23
**Confidence:** HIGH

---

## Executive Summary

Brain Core v1.4 adds three independent capability domains to an already-stable platform: knowledge
retrieval via RAG (text ingest + pgvector search), outbound tool event publishing (side-channel
notifications to CRMs and n8n workflows), and FUP Automático (a database-persisted follow-up
scheduler). The research confirms that all three can be built with a net addition of exactly two npm
packages — `@langchain/textsplitters ^0.1.0` and `croner ^10.0.1` — because the existing stack
(pgvector, Drizzle, postgres.js, LangGraph, rabbitmq-client, Bun native `fetch()`) already covers
the remaining requirements. This keeps the dependency surface minimal and the upgrade risk low.

The recommended build order is dictated by the dependency graph: database migrations first (all
three features need new schema), then Tool Events (simplest feature, its `IToolEventPublisher`
interface is reused by FUP), then RAG (self-contained in a new `packages/rag`), and finally FUP
(most complex, depends on the leads table additions, Tool Events publisher, and BrainRunner graph
access). Each phase is independently shippable and testable in isolation.

The dominant risks are not integration complexity but operational correctness: RAG embeddings are
silently corrupted if the embedding model changes without a re-index (RAG-01); FUP messages are
double-sent if multiple Brain instances race without distributed locking (FUP-01); and the entire
FUP scheduler state is lost on container restart if it is held in memory rather than the DB
(FUP-02). All three are design-time decisions that cannot be retrofitted cheaply. They must be
addressed in the initial implementation of each phase.

---

## Key Findings

### Stack Additions (net new for v1.4)

The existing stack — Bun 1.x, Hono 4.12.x, LangGraph 1.x, Drizzle 0.45.x (postgres.js driver),
pgvector 0.3.x, rabbitmq-client 5.x, `@langchain/openai`, `@langchain/google-genai`, Pino — is
**unchanged** for v1.4. Two packages are added:

**New packages:**

| Package | Version | Purpose | Install Target |
|---------|---------|---------|---------------|
| `@langchain/textsplitters` | `^0.1.0` | `RecursiveCharacterTextSplitter` for RAG ingest | `packages/rag` |
| `croner` | `^10.0.1` | Timezone-aware cron scheduler for FUP (replaces `setInterval` per-lead) | `packages/fup` |

**Why `croner` over `Bun.cron()`:** Bun's built-in `Bun.cron()` is UTC-only for in-process
callbacks — no `timezone` parameter. FUP must enforce `FUP_MIN_HOUR`/`FUP_MAX_HOUR` in
`America/Sao_Paulo` (configurable via `FUP_TIMEZONE` ENV). `croner` uses the runtime's Intl API
(no bundled IANA database), has zero dependencies, and is explicitly Bun >=1.0.0 compatible.

**What requires NO new packages:** embeddings (reuse `createEmbeddings()` factory in `packages/ai`),
vector storage (reuse pgvector + existing HNSW infrastructure), outbound webhook events (Bun
native `fetch()`), outbound RabbitMQ events (reuse `rabbitmq-client` Publisher API), timezone
arithmetic for FUP gate checks (Bun's V8 carries full IANA DB via `Intl.DateTimeFormat`).

**Schema changes (migrations only, no new packages):**

- New table: `knowledge_chunks` — RAG knowledge storage, `collection` column as namespace
- New table: `fup_config` — FUP intervals and rules per `brain_type`, DB-driven (no redeploy needed)
- Modified table: `leads` — add `fup_enabled`, `fup_step`, `fup_next_at`, `last_message_at` columns

**Do NOT add:** `luxon`, `date-fns-tz`, `node-cron`, `pg-boss`, `bullmq`, `langchain` (monolith),
`@langchain/community`, `tiktoken` (native WASM), `axios`/`got`.

---

### Expected Features

**RAG — Must have (table stakes):**
- `POST /api/v1/ingest` — accepts `{ text, collection, metadata? }`, chunks, embeds, stores in pgvector
- `RecursiveCharacterTextSplitter` with `chunkSize: 512`, `chunkOverlap: 50` via `@langchain/textsplitters`
- `search_knowledge` StructuredTool registered in ToolsRegistry — accepts `{ query, collection, top_k? }`
- Cosine similarity query with `collection` filter on `knowledge_chunks` HNSW index
- Score threshold (default 0.60) — reject chunks below threshold before returning to LLM
- `embedding_model` stored per row in `knowledge_chunks` — required to detect drift (RAG-01)

**RAG — Should have (differentiators, defer if timeline tight):**
- `content_hash` column for duplicate prevention on re-ingest
- Configurable `top_k` and score threshold per tool call
- `chunk_index` and `total_chunks` stored per row (context framing for LLM)

**RAG — Do NOT build in v1.4:**
- Semantic chunking (embedding-based split points — expensive, marginal gain)
- PDF/DOCX/HTML parsing at ingest (caller's responsibility — accept raw text only)
- Separate vector DB (pgvector is sufficient at Brain scale)
- Cross-encoder re-ranking (v2+ optimization)
- Per-Brain vector tables (use single table + `collection` column)

**Tool Events — Must have:**
- `BaseCallbackHandler.handleToolEnd()` subclass (`ToolEventPublisher`) — covers all native tools automatically
- Fire-and-forget delivery: `void publisher.publish(...).catch(logger.warn)` — never blocking
- Event payload: `{ event_id, action, lead: { id, unique_id, numero, nome }, result, timestamp, brain_type }`
- `event_id` derived from `tool_call_id` — required for consumer idempotency (EVT-05)
- Transport selection via `TOOL_EVENTS_TRANSPORT=webhook|rabbitmq` ENV
- `createToolEventPublisher()` factory returns `null` when ENVs not configured (feature opt-in)

**Tool Events — Should have:**
- `EVENT_TOOLS` ENV allowlist — filter which tools emit events (prevent flooding with `search_knowledge` events)

**Tool Events — Do NOT build:**
- Modifying individual tool `_call()` methods (couples tools to transport)
- `tool_events` DB table (duplicates LangGraph checkpoint)
- Synchronous event publication (blocks tool return path)
- Retry with exponential backoff (fire-and-forget; consumers handle guarantees)
- Separate HTTP server for event publishing

**FUP Automático — Must have:**
- `fup_schedule` table with: `lead_id`, `step`, `next_fup_at` (UTC), `status` (pending/in_progress/sent/cancelled/completed), `failure_count`
- `SELECT ... FOR UPDATE SKIP LOCKED` to claim FUP records — prevents double-send across instances (FUP-01)
- All FUP state in DB — no in-memory timer per lead (FUP-02)
- Business hours gate using `Intl.DateTimeFormat` (timezone-aware) — checked before every send
- LLM-generated FUP messages via `BrainRunner.runFup()` — reuses compiled LangGraph graph
- Send via existing Tool Events outbound channel (`toolEventPublisher`)
- Cancel pending FUPs in `LeadService` on every incoming message (FUP-08)
- `last_message_at` updated on every `BrainRunner.run()` turn via `LeadService.upsert()` (FUP-05)
- `ia_ativada=false` + `fup_enabled=false` after last FUP step (automatic deactivation per spec)

**FUP — Should have (defer if timeline tight):**
- `fup_logs` audit table for delivery reporting
- `POST /api/v1/leads/:id/fup/pause` and `/resume` endpoints

**FUP — Do NOT build:**
- Full `graph.invoke()` FUP turn (one-shot LLM call is sufficient)
- External job queue (BullMQ + Redis, pg_boss)
- `pg_cron` extension (not available on managed PG)
- FUP logic inside LangGraph nodes
- `setInterval` per lead (use DB poll-based scheduler via `croner`)

---

### Architecture Approach

The three features map to distinct packages following the existing "another Brain can reuse this"
principle. `packages/rag` is a new package for ingest + search, mounting a `createRagApp(sql): Hono`
sub-app in each Brain's `createServer()`. `packages/fup` is a new package for the scheduler,
started by `BrainRunner.init()` and stopped by `BrainRunner.close()`. Tool Events live inside
`packages/core` as `packages/core/src/events/publisher.ts` — co-located with the tool factories
they augment. A critical architectural constraint is that the event publisher must NOT live inside
`packages/transport` to avoid a circular dependency (`transport -> events -> transport`, EVT-04);
if this grows, extract to `packages/events`.

**New packages:**
1. `packages/rag` — ingest endpoint (`createRagApp`) + search tool (`createSearchKnowledgeTool`)
2. `packages/fup` — `FupScheduler` class, polling loop, business hours gate, LLM generation

**Modified components (packages/core):**
- `BrainBuildContext` — add `ragTools: StructuredTool[]` and `toolEventPublisher?: IToolEventPublisher`
- `BrainRunner._compileGraph()` — create publisher + ragTools; inject into context
- `BrainRunner.init()` — start `FupScheduler` when `FUP_ENABLED=true`
- `BrainRunner.run()` — call `LeadService.touchLastMessage()` after every turn
- `BrainRunner` — add internal `runFup(lead, message): Promise<BrainOutput|null>`
- `createPauseSessionTool()`, `createFinishConversationTool()` — accept optional `IToolEventPublisher`
- `LeadService` — add `touchLastMessage(uniqueId)`, `getFupCandidates()`

**Modified in apps (both Brains):**
- `createServer()` — mount `createRagApp(sql)` as 4th sub-app
- `buildGraph()` — spread `ctx.ragTools` into `bindTools()` and `ToolNode`

**Key design decision — FUP send path:** FUP does NOT hold a reference to `ITransport` directly.
Instead, `BrainRunner.runFup()` invokes the compiled LangGraph with a synthetic `[FUP_TRIGGER]`
HumanMessage, gets `BrainOutput`, and publishes via the existing `toolEventPublisher`. This reuses
the compiled graph (correct LLM + FUP system prompt + conversation history via PostgresSaver) and
avoids duplicating outbound transport logic.

---

### Critical Pitfalls

**Top 8 — must prevent in implementation:**

1. **RAG-01: Embedding model drift silently corrupts all vectors** — Store `embedding_model` per
   row in `knowledge_chunks`. Add startup assertion comparing `EMBEDDING_MODEL` env against
   `SELECT DISTINCT embedding_model FROM knowledge_chunks`. Model changes require full re-index.

2. **FUP-01: Multiple Brain instances double-send the same FUP** — Use `SELECT ... FOR UPDATE
   SKIP LOCKED` inside a transaction when claiming FUP records. Only the instance that wins the
   lock sends. This is the foundational pattern for FUP correctness in scaled deployments.

3. **FUP-02: In-memory scheduler state lost on container restart** — All FUP state must be in the
   `fup_schedule` table with UTC `next_fup_at`. Use a DB poll loop, not `setTimeout` per lead.
   On startup, immediately process rows where `next_fup_at <= NOW()`.

4. **EVT-01: Publisher blocks LangGraph tool return if awaited** — Use `void publisher.publish(...).catch(logger.warn)`. Never `await` in the tool function body. Set an internal 2-second
   timeout in the publisher; resolve (not reject) on timeout.

5. **EVT-04: Circular import transport -> events -> transport** — `EventPublisher` must NOT
   import from `packages/transport`. It imports `rabbitmq-client` directly (already a transitive
   dep). Run `madge --circular packages/` in CI to enforce this.

6. **FUP-07: `setInterval` RSS memory growth in long-running Bun process** — Use a self-scheduling
   `setTimeout` chain (next tick starts in `finally` block of current tick) instead of `setInterval`.
   `setInterval` in Bun has documented RSS growth that OOMKills pods after 12-24h.

7. **RAG-03: HNSW pre-filter recall degradation with collection filter** — Set `hnsw.iterative_scan
   = relaxed_order` and `hnsw.max_scan_tuples = 20000` in the query session before filtered vector
   searches. Without this, pgvector returns fewer than K results when only 20-30% of rows match
   the collection filter.

8. **FUP-05: `last_message_at` stale — FUP fires on active leads** — Update `last_message_at = NOW()`
   in `LeadService.upsert()` on EVERY incoming message, unconditionally. `updated_at` is not a
   valid proxy — it is only updated when lead fields change.

**Additional pitfalls to track:**
- RAG-02: Startup assertion for embedding dimension mismatch (Gemini silently produces 3072-dim vectors regardless of `EMBEDDING_DIMENSIONS` env)
- RAG-04/RAG-05: Use `RecursiveCharacterTextSplitter` (character-based); never `TokenTextSplitter` with tiktoken (WASM fails in Bun)
- EVT-02: Lead data not in tool closure — pass `lead` into tool factory at `BrainRunner.run()` time, not at graph-compile time
- EVT-03: RabbitMQ publish to undefined queue drops events silently — `confirm: true` on publisher + startup validation of `TOOL_EVENTS_QUEUE`
- EVT-05: Tool re-execution on LangGraph resume causes duplicate events — include `event_id = thread_id:tool_call_id` in payload; document at-least-once guarantee
- FUP-03: DST transition fires FUP at wrong hour — store UTC timestamps; compute `next_fup_at` with `date-fns-tz`'s `fromZonedTime()` (or `croner` which uses Intl internally)
- FUP-04: LLM failure silently advances FUP step — only update `status = 'sent'` after confirmed transport delivery; keep `failure_count`, stop after 3 failures
- FUP-06: FUP fires during active conversation (race) — re-read `last_message_at` inside the SKIP LOCKED transaction; cancel if lead replied since FUP was scheduled
- FUP-08: FUP sequence not cancelled when lead responds — cancel `pending` rows in `fup_schedule` in `LeadService` on every incoming message

---

## Implications for Roadmap

### Phase A: Database Foundation
**Rationale:** All three features depend on schema. Doing this first eliminates the "migration
first" dependency from every subsequent phase and allows the entire v1.4 codebase to build on a
stable schema from day one.

**Delivers:** Migration `0007_v1_4_foundation` with `knowledge_chunks` table, `fup_config` table,
new `leads` columns (`fup_enabled`, `fup_step`, `fup_next_at`, `last_message_at`). Updated Drizzle
schema exports. `LeadService.touchLastMessage()` and `LeadService.getFupCandidates()` added.
`BrainRunner.run()` updated to call `touchLastMessage()` after every turn.

**Avoids:** FUP-05 (stale `last_message_at`) — the column and update must exist before FUP scheduler
is written.

**Research flags:** None — Drizzle migration pattern is established and proven in v1.0-v1.3.

---

### Phase B: Tool Events
**Rationale:** Simplest feature with no dependencies on RAG or FUP. Delivers immediate value
(existing tools start publishing events to CRMs/n8n). The `IToolEventPublisher` interface defined
here is reused by FUP's outbound message delivery, so it must exist before FUP is built.

**Delivers:** `packages/core/src/events/publisher.ts` with `IToolEventPublisher` interface and
`createToolEventPublisher()` factory. `ToolEventPublisher` implementation for webhook and RabbitMQ.
`createPauseSessionTool()` and `createFinishConversationTool()` wired with optional publisher.
`BrainBuildContext` extended with `toolEventPublisher?`. `BrainRunner._compileGraph()` creates and
injects publisher from ENV.

**Addresses:** Fire-and-forget event notification for `qualify_lead`, `pause_session`,
`finish_conversation` tool completions.

**Avoids:** EVT-01 (blocking), EVT-02 (lead context threading), EVT-03 (confirm mode + startup
validation), EVT-04 (no circular import with transport), EVT-05 (`event_id` in payload from day one).

**Research flags:** None — callback patterns are well-documented. Verify EVT-04 (circular import)
with `madge --circular` immediately after first implementation.

---

### Phase C: RAG
**Rationale:** Self-contained new package. No dependency on Tool Events or FUP. Can be developed
and shipped independently. The `search_knowledge` tool automatically benefits from Tool Events
once both phases are shipped.

**Delivers:** `packages/rag` with `createRagApp(sql): Hono` (POST /api/v1/ingest) and
`createSearchKnowledgeTool(sql): StructuredTool`. `knowledge_chunks` table with `embedding_model`
column. `BrainBuildContext` extended with `ragTools`. Both Brain apps mount `createRagApp` and
spread `ragTools`. `KNOWLEDGE_COLLECTIONS` and `INGEST_TOKEN` ENVs.

**Addresses:** Knowledge base ingestion and semantic retrieval for SDR conversations.

**Avoids:** RAG-01 (embedding_model per row), RAG-02 (startup dimension assertion), RAG-03
(iterative HNSW scan), RAG-04/RAG-05 (RecursiveCharacterTextSplitter, not tiktoken).

**Research flags:** Confirm pgvector version is 0.8.x in production Docker image before writing the
search query — `hnsw.iterative_scan = relaxed_order` only exists in 0.8.0+ (RAG-03 blocker).

---

### Phase D: FUP Automático
**Rationale:** Most complex feature. Depends on Phase A (DB schema, `last_message_at`), Phase B
(`IToolEventPublisher` for outbound delivery), and `BrainRunner` (for `runFup()` method). Build
last when all dependencies are stable.

**Delivers:** `packages/fup` with `FupScheduler` class. Self-scheduling `setTimeout` loop
(not `setInterval` — FUP-07). `SELECT ... FOR UPDATE SKIP LOCKED` claim pattern (FUP-01). DB-
persisted `fup_schedule` state (FUP-02). Business hours gate via `Intl.DateTimeFormat` (FUP-03).
`BrainRunner.runFup()` internal method. `BrainRunner.init()` starts scheduler when
`FUP_ENABLED=true`. `BrainRunner.close()` stops scheduler on SIGTERM. `fup_config` table seeded
via migration SQL.

**Addresses:** Automated follow-up for silent leads with configurable intervals, business hours
enforcement, LLM-personalized messages, and automatic deactivation on last step.

**Avoids:** FUP-01 through FUP-08. The `FOR UPDATE SKIP LOCKED` and DB-persistence patterns are
non-negotiable correctness constraints for this phase.

**Research flags:** Prototype `BrainRunner.runFup()` with a synthetic HumanMessage before building
the full scheduler — the behavior of a FUP-trigger message flowing through the existing SDR graph
is untested and must be validated before the scheduler depends on it.

---

### Phase Ordering Rationale

- DB first: migrations are foundational; phases B/C/D all reference columns and tables from Phase A
- Tool Events before FUP: `IToolEventPublisher` interface is a FUP dependency (FUP uses it for outbound send); building it second gives the interface time to stabilize before FUP consumes it
- RAG before FUP optionally: RAG and FUP are truly independent; however, once RAG exists, the FUP message generator can optionally query the knowledge base for richer messages
- FUP last: requires the most integration surface (DB columns, BrainRunner internals, Tool Events interface) and has the highest correctness risk

### Research Flags

**Needs verification during execution (not full research — just check before coding):**
- Phase B: Verify `handleToolEnd` fires for MCP-proxied tools — undocumented in `@langchain/mcp-adapters`; MCP tool events may need to be deferred to v1.5
- Phase C: Confirm pgvector 0.8.x in Docker image — `hnsw.iterative_scan` option gated on version
- Phase D: Prototype `BrainRunner.runFup()` with synthetic HumanMessage before building scheduler

**Standard patterns (skip additional research):**
- Phase A: Drizzle migration — used 6 times; well-understood
- Phase B (webhook path): Bun native `fetch()` fire-and-forget — zero unknowns
- Phase C (chunking): `RecursiveCharacterTextSplitter` config documented with production benchmarks

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (new packages) | HIGH | Both packages verified Bun-compatible with CI workflows; peer deps confirmed satisfied |
| Stack (reused packages) | HIGH | All reuse claims verified by direct codebase read of existing factories and schemas |
| Features (RAG) | HIGH | Multiple cross-referenced sources; pgvector patterns proven in production |
| Features (Tool Events) | HIGH | LangChain.js callback API stable; fire-and-forget pattern is idiomatic |
| Features (FUP) | HIGH | Core patterns well-documented; integration with BrainRunner is the only unvalidated piece |
| Architecture | HIGH | Based on direct codebase read — no external assumptions; all existing interfaces verified |
| Pitfalls | HIGH | Each pitfall sourced from production incidents, official issue trackers, or documented bugs |

**Overall confidence: HIGH**

### Gaps to Address

- **MCP tool events scope:** `handleToolEnd` behavior for MCP-proxied tools is undocumented in
  `@langchain/mcp-adapters`. Test explicitly in Phase B before shipping event publishing.

- **Gemini embedding dimensions:** `GoogleGenerativeAIEmbeddings` may ignore `output_dimensionality`.
  If `LLM_PROVIDER=gemini` is used for embeddings, verify actual output dimensions match
  `EMBEDDING_DIMENSIONS` before allowing ingest. The startup assertion (RAG-02) catches this at
  runtime, but it should also be tested in CI before Phase C ships.

- **`BrainRunner.runFup()` graph behavior:** Running the SDR LangGraph with a synthetic
  `[FUP_TRIGGER]` HumanMessage has not been tested. The SDR graph routing logic may react
  unexpectedly — validate with a manual test before building the full FUP scheduler loop.

---

## Sources

### Primary (HIGH confidence — direct codebase read or official docs)
- Direct codebase read (all packages) — architecture findings, existing interfaces, schema
- Bun.cron() official docs (UTC-only limitation confirmed): https://bun.com/docs/runtime/cron
- croner v10 GitHub (Bun >=1.0.0 confirmed, timezone option, zero deps): https://github.com/Hexagon/croner
- pgvector 0.8.0 release (iterative scan introduced): https://www.postgresql.org/about/news/pgvector-080-released-2952/
- LangChain.js BaseCallbackHandler reference: https://reference.langchain.com/javascript/langchain-core/callbacks/base/BaseCallbackHandler
- @langchain/textsplitters npm (v0.1.0, peer dep confirmed): https://www.npmjs.com/package/@langchain/textsplitters
- Bun setInterval RSS memory leak (issue #16488): https://github.com/oven-sh/bun/issues/16488

### Secondary (HIGH confidence — multiple sources agree)
- PostgreSQL SKIP LOCKED for distributed scheduling (multiple production references)
- pgvector HNSW pre-filter recall degradation (pgvector docs + AWS Aurora blog + dev.to)
- Embedding model drift production pitfalls (Medium + Tianpan.co, cross-referenced)
- RAG chunking strategy benchmarks (Weaviate + unsiloed.ai + aiagentsbuzz, 2026)
- tiktoken WASM failure in non-Node runtimes (LangChainJS GitHub issue #665 + Lambda reports)
- DST timezone bugs in node-cron vs croner (pkgpulse.com 2026 comparison)
- LangGraph tool re-execution on resume (official LangChain blog on fault tolerance)

---
*Research completed: 2026-06-23*
*Milestone: Brain Core v1.4 — RAG + Tool Events + FUP Automático*
*Ready for roadmap: yes*
