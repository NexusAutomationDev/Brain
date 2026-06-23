# Architecture Patterns: v1.4 RAG + Tool Events + FUP Automático

**Milestone:** v1.4 RAG + Tool Events + FUP Automático
**Researched:** 2026-06-23
**Confidence:** HIGH (entire existing codebase read directly; no external assumptions)

---

## Existing Architecture Snapshot

Before prescribing changes, here is what exists and is load-bearing:

```
packages/
  shared/      — BrainOutput, TokenUsage, ConfigurationError types (no Zod, no circular deps)
  database/    — TenantPoolManager, runMigrations(), Drizzle schema (tables.ts)
  ai/          — BrainStateAnnotation, createLLM(), createEmbeddings(), createCheckpointer()
  memory/      — MemoryManager, upsertEmbedding(), searchSimilar()
  observability/ — createLogger(), createHealthApp(), createTracingCallbacks()
  transport/   — ITransport, BrainEvent, WebhookTransport, RabbitMQTransport, createTransport()
  core/        — IBrain, BrainBuildContext, BrainRunner, LeadService, ToolsRegistry,
                 createPauseSessionTool(), createFinishConversationTool(), createRespondTool()

apps/
  brain-sdr/   — sdrBrain: IBrain, createServer() mounts 3 sub-apps
  brain-echo/  — echoBrain: IBrain, createServer()
```

Key data flows already in place:
- BrainRunner.init() → runMigrations() → loadPrompts() → _compileGraph()
- BrainRunner.run(event) → LeadService.upsertLead() → graph.invoke() → BrainOutput
- _compileGraph() builds BrainBuildContext { llm, prompts, tools, sql, mcpTools } → brain.buildGraph(ctx)
- Server per Brain: createServer(sql, runner) → Hono with /health, /api/v1/webhook, /reload-prompts
- Transport: TRANSPORT=webhook (WebhookTransport) or TRANSPORT=rabbitmq (RabbitMQTransport)

Existing `embeddings` table: userId, sessionId, content, embedding vector, metadata, createdAt.
Scoped to conversation memory (semantic.ts: upsertEmbedding / searchSimilar). This is the write-path
dead code (MEM-03) — createEmbeddings() called in factory but upsertEmbedding() has no caller.

---

## Feature 1: RAG (Retrieval-Augmented Generation)

### Package Placement Decision

**Location: packages/rag (new package)**

Rationale:
- RAG crosses package boundaries: it needs packages/ai (createEmbeddings), packages/database (Drizzle
  schema + sql), and packages/transport (Hono sub-app). A new package is cleaner than fattening any
  existing one.
- packages/ai already owns LLM/embedding factories — pulling ingest + search logic there creates an
  HTTP concern (Hono route) inside an AI primitives package. Wrong responsibility.
- packages/database already owns schema/migrations only — adding chunking + HTTP there is wrong.
- packages/memory already owns conversation-scoped semantic memory (embeddings table scoped to userId).
  Knowledge chunks are domain-scoped (collection-based), not user-scoped. Different access pattern.
- A new packages/rag keeps the concern isolated and usable by any Brain via BrainBuildContext.

**Do NOT reuse the existing `embeddings` table for RAG knowledge chunks.**
The `embeddings` table is scoped by `(userId, sessionId)` — it is conversation memory.
RAG knowledge is scoped by `(collection)` — it is shared reference data for all leads.
Mixing these into one table creates query confusion and index inefficiency.

### New DB Table: knowledge_chunks

```typescript
// packages/database/src/schema/tables.ts (add)
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  collection: text('collection').notNull(),          // logical namespace, e.g. "sdr-faq"
  content: text('content').notNull(),                // chunk text
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
  metadata: jsonb('metadata').default({}),           // source, page, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  embeddingIdx: index('kc_embedding_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 }),
  collectionIdx: index('kc_collection_idx').on(table.collection),
}));
```

This requires a new migration file in `packages/database/src/migrations/`.

### Ingest Endpoint: How It Attaches to Hono

The ingest route lives in packages/rag as `createRagApp(sql: Sql): Hono`. It is mounted in each Brain's
`createServer()` as a fourth sub-app, alongside the existing three:

```typescript
// apps/brain-sdr/src/server.ts (modified)
import { createRagApp } from "@brain-pkg/rag";

export function createServer(sql: Sql, runner: BrainRunner): Hono {
  const app = new Hono();
  app.route("/", createHealthApp(sql));
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));
  app.route("/", createRagApp(sql));   // NEW — POST /api/v1/ingest
  return app;
}
```

Why sub-app pattern (not middleware, not separate server):
- Consistent with how createWebhookApp, createHealthApp, createCoreApp are composed.
- No new port — same Hono instance, same process.
- sql is already available in createServer() (it is passed by index.ts).
- Ingest is admin/write — must have its own auth (same ADMIN_TOKEN pattern as /reload-prompts or a
  dedicated INGEST_TOKEN env). Not the same as WEBHOOK_TOKEN.

Endpoint signature:
```
POST /api/v1/ingest
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{ "text": "...", "collection": "sdr-faq", "metadata": {} }

Response 200: { "status": "ok", "chunks": 3 }
```

### Ingest Data Flow

```
POST /api/v1/ingest
  → auth check (INGEST_TOKEN)
  → validate body (Zod: text, collection, metadata?)
  → chunk text (simple: split by paragraph or fixed-size with overlap)
  → createEmbeddings() → embedMany(chunks)
  → INSERT INTO knowledge_chunks (collection, content, embedding, metadata) — batch
  → return { status: "ok", chunks: N }
```

Chunking strategy for v1: fixed-size chunks (512 chars) with 64-char overlap. No external chunking
library needed — a simple string-split function inside packages/rag is sufficient. Do NOT bring in
LangChain text splitters for this; a 20-line local function is cleaner given Bun constraints.

### search_knowledge Tool: Where It Lives and How It's Instantiated

**Location: packages/rag — exported as `createSearchKnowledgeTool(sql: Sql, collection?: string)`**

Pattern matches the existing tool factories (createPauseSessionTool, createFinishConversationTool):
factory function with closure over sql, returns a StructuredTool.

```typescript
// packages/rag/src/tools/search-knowledge.ts
export function createSearchKnowledgeTool(sql: Sql, defaultCollection?: string): StructuredTool
```

**How it gets into BrainBuildContext:**
BrainBuildContext already has `mcpTools: StructuredTool[]` — a parallel field `ragTools: StructuredTool[]`
is added to carry RAG tools injected by BrainRunner:

```typescript
// packages/core/src/brain/interface.ts (modified)
export interface BrainBuildContext {
  llm: BaseChatModel;
  prompts: Record<string, string>;
  tools: StructuredTool[];
  sql?: Sql;
  mcpTools: StructuredTool[];
  ragTools: StructuredTool[];   // NEW — [] when RAG not configured (no KNOWLEDGE_COLLECTIONS env)
}
```

BrainRunner._compileGraph() creates ragTools based on ENV:
```
KNOWLEDGE_COLLECTIONS=sdr-faq,sdr-products   → one createSearchKnowledgeTool per collection
                                                or one tool that accepts collection as param
```

Simpler approach: single tool that accepts `collection` as a parameter in its Zod schema. The LLM
provides the collection name based on context. This avoids N tools for N collections.

Brain's buildGraph() spreads ragTools into bindTools() exactly as mcpTools:
```typescript
const llmWithTools = ctx.llm.bindTools([
  ...nativeTools,
  ...ctx.mcpTools,
  ...ctx.ragTools,   // NEW
]);
```

The ToolNode in each Brain receives ragTools alongside the other tools.

**This means Brains do NOT need to know about RAG explicitly** — they receive pre-built tools
in BrainBuildContext and spread them. RAG is infrastructure, not Brain-specific.

### search_knowledge Tool Data Flow

```
LLM calls search_knowledge({ query: "...", collection: "sdr-faq" })
  → createEmbeddings().embedQuery(query)
  → SELECT FROM knowledge_chunks WHERE collection = ?
      ORDER BY embedding <=> queryVector
      LIMIT 5
  → return joined chunk content as string (LLM consumes as tool result)
```

The tool uses cosine distance on the HNSW index — same pattern as searchSimilar() in packages/memory/
semantic.ts. packages/rag can import packages/database for the schema and Drizzle, and packages/ai
for createEmbeddings().

---

## Feature 2: Tool Events (Outbound Event Channel)

### Package Placement Decision

**Location: packages/core — alongside the tool factories**

Rationale:
- Tool events are about what happens when a tool runs. The tool factories (createPauseSessionTool,
  createFinishConversationTool, createRespondTool) already live in packages/core. The event publisher
  is most naturally co-located with the tools it wraps.
- packages/transport already handles inbound events (BrainEvent in, BrainOutput out). Adding an
  outbound publisher there would conflate two distinct responsibilities.
- The publisher itself is simple: send HTTP POST or publish to RabbitMQ queue. No new deps needed
  — packages/core already depends on packages/transport for BrainEvent, and the rabbitmq-client
  library is already in the dependency tree.

**New file: packages/core/src/events/publisher.ts**

```typescript
export interface ToolEventPayload {
  action: string;                 // tool name: "pause_session", "qualify_lead", etc.
  lead: {
    id: string;                   // lead.uniqueId (IDLead)
    nome: string | null;
    numero: string;
  };
  result: string;                 // tool return value (stringified)
  timestamp: string;              // ISO 8601
}

export interface IToolEventPublisher {
  publish(payload: ToolEventPayload): Promise<void>;
}

export function createToolEventPublisher(): IToolEventPublisher | null
```

Returns null when neither TOOL_EVENTS_WEBHOOK_URL nor TOOL_EVENTS_RABBITMQ_QUEUE is configured.
This allows BrainRunner to skip event publishing without error when the feature is not configured.

ENV-based selection (same pattern as TRANSPORT env):
- `TOOL_EVENTS_WEBHOOK_URL` → HTTP POST (fire-and-forget, no retry needed for events)
- `TOOL_EVENTS_RABBITMQ_QUEUE` → publish to named queue (reuses existing RABBITMQ_URL)

### How BrainRunner Triggers Event Publishing

**Mechanism: tool wrapper in _compileGraph(), not LangGraph callbacks**

LangGraph callbacks (via `createTracingCallbacks`) are for observability tracing only and not
appropriate for side-effect publishing. Tool wrapping is cleaner and already done in brain.ts:
the `boundQualifyTool` pattern shows how to wrap a tool's invoke function with additional logic.

BrainRunner cannot directly wrap individual Brain tools (Brain is a black box from the runner's
perspective). The integration point is:

**Option A (recommended): Pass publisher into BrainBuildContext, let each tool factory handle it**

```typescript
// packages/core/src/brain/interface.ts (modified)
export interface BrainBuildContext {
  llm: BaseChatModel;
  prompts: Record<string, string>;
  tools: StructuredTool[];
  sql?: Sql;
  mcpTools: StructuredTool[];
  ragTools: StructuredTool[];
  toolEventPublisher?: IToolEventPublisher;  // NEW — null when not configured
}
```

Tool factories accept publisher optionally and fire events after their DB update:

```typescript
export function createPauseSessionTool(sql: Sql, publisher?: IToolEventPublisher): StructuredTool
```

The tool's implementation becomes:
```
await db.update(leads)...
await publisher?.publish({ action: "pause_session", lead: {...}, result: "Sessão pausada" })
return "Sessão pausada com sucesso"
```

BrainRunner._compileGraph() creates the publisher from ENV and injects it:
```typescript
const toolEventPublisher = createToolEventPublisher(); // null if not configured
const ctx: BrainBuildContext = { ..., toolEventPublisher };
```

**Why not Option B (LangGraph DispatchCustomEvent / callbacks):**
LangGraph's event dispatch system would work but adds ceremony (async generators, streaming callbacks).
The tool wrapper approach is already established in this codebase (boundQualifyTool) and simpler.

**For mcpTools:** MCP tools cannot be wrapped with a publisher in advance since they come from the
external MCP server. After the graph runs, the tool results are in the messages array in state.
For v1.4, limit event publishing to native tools only. MCP tool event publishing deferred.

### Tool Events Data Flow

```
LLM calls pause_session (tool_call in AIMessage)
  → ToolNode executes createPauseSessionTool()
  → DB: UPDATE leads SET fullpp=false WHERE unique_id=?
  → publisher.publish({ action: "pause_session", lead: {...}, result: "..." })
      └── TOOL_EVENTS_WEBHOOK_URL set → fetch(url, { method: "POST", body: JSON })
      └── TOOL_EVENTS_RABBITMQ_QUEUE set → rabbit.publish(queue, payload)
      └── fire-and-forget: errors logged, NOT propagated to tool return
  → return "Sessão pausada com sucesso"
  → ToolMessage injected into state.messages (existing flow unchanged)
```

The publisher is fire-and-forget. Tool return value is unchanged — no impact on existing LangGraph
message flow or BrainOutput contract.

**Lead context for the publisher:** The tool factories currently only receive `sql`. To publish lead
info, they need access to lead data (nome, numero). Two approaches:

- Read lead from DB inside the tool using threadId from RunnableConfig (same pattern as the UPDATE —
  the threadId is the uniqueId, so `SELECT * FROM leads WHERE unique_id = ?`).
- Or: add lead data as a parameter to the tool factory (requires callers to pass it in buildGraph).

The DB read approach is cleaner — one extra SELECT per tool invocation, negligible cost, and avoids
coupling buildGraph() to lead data at construction time.

---

## Feature 3: FUP Automático (Follow-Up Scheduler)

### Package Placement Decision

**Location: packages/fup (new package)**

Rationale:
- FUP is a significant new subsystem: scheduler loop, DB reads for candidate leads, LLM invocation,
  config storage, transport send. This is not a minor extension to any existing package.
- packages/core is already the Brain orchestration SDK; a background scheduler is a separate concern.
- A dedicated package keeps BrainRunner clean and makes FUP testable in isolation.
- Other future Brains will want FUP too — it must be in packages/, not apps/.

### New DB Columns on `leads` Table

The scheduler needs per-lead FUP state. Add to `leads` table:

```typescript
// packages/database/src/schema/tables.ts (add to leads table)
fupEnabled: boolean('fup_enabled').notNull().default(false),
fupStep: integer('fup_step').notNull().default(0),
fupNextAt: timestamp('fup_next_at'),          // null = not scheduled
lastMessageAt: timestamp('last_message_at'),  // null = no message yet (updated on every BrainRunner.run())
```

**`lastMessageAt`** must be updated by BrainRunner.run() on every successful turn (ia_ativada=true,
not null result). This is one line in LeadService.upsertLead() or a dedicated
`LeadService.touchLastMessage(uniqueId)` call at the end of BrainRunner.run().

**`fupEnabled`** is set to true by external integrations (CRM, manual admin call). It is NOT
automatically true for all leads — FUP is opt-in per lead.

**`fupStep`** tracks which follow-up message was last sent (0=none sent, 1=first sent, etc.).
Incremented after each FUP send. When step reaches the last configured interval, set
`fupEnabled=false` (automatic deactivation per spec).

**`fupNextAt`** set to `NOW() + interval[step]` after each FUP send (or on lead creation if
fupEnabled=true). Scheduler queries `WHERE fup_enabled=true AND fup_next_at <= NOW()`.

### New DB Table: fup_config

FUP intervals and rules stored in DB (per brainType, configurable without redeploy):

```typescript
export const fupConfig = pgTable('fup_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  brainType: text('brain_type').notNull().unique(),
  // intervals in seconds — e.g. [300, 900, 3600] means FUP at 5min, 15min, 1h
  intervals: jsonb('intervals').notNull().$type<number[]>(),
  // allowed hours window: { start: 8, end: 20 } (inclusive, in timezone)
  allowedHours: jsonb('allowed_hours').notNull().$type<{ start: number; end: number }>(),
  // allowed days: [1,2,3,4,5] = Mon-Fri (0=Sun, 6=Sat)
  allowedDays: jsonb('allowed_days').notNull().$type<number[]>(),
  // IANA timezone string: "America/Sao_Paulo"
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  // FUP prompt key — loaded from prompts table by BrainType
  promptKey: text('prompt_key').notNull().default('fup'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

This table is seeded via a migration SQL file (same as brain SDR prompts in 0005_brain_sdr_prompts.sql).

### FUP Scheduler: Where It Lives and Starts

**Class: packages/fup/src/FupScheduler.ts**

```typescript
export interface FupSchedulerOptions {
  sql: Sql;
  brainType: string;
  transport: ITransport;           // reuse existing transport to send messages
  llm: BaseChatModel;             // reuse BrainRunner's LLM for generation
  checkpointer: BaseCheckpointSaver; // for reading conversation history
}

export class FupScheduler {
  async start(): Promise<void>     // begins setInterval loop
  async stop(): Promise<void>      // clears interval
}
```

**Started by BrainRunner.init()**, after graph compilation:

```typescript
// packages/core/src/runner/runner.ts (modified init())
if (process.env.FUP_ENABLED === "true") {
  this.fupScheduler = new FupScheduler({
    sql: this.sql,
    brainType: this.brain.brainType,
    transport: this.transport,     // PROBLEM: BrainRunner doesn't currently hold transport
    llm,
    checkpointer,
  });
  await this.fupScheduler.start();
}
```

**The transport injection problem:** BrainRunner currently does not hold a reference to the ITransport
(transport is created in apps/brain-sdr/src/index.ts and not passed into the runner). For FUP,
the scheduler needs to send messages via the same channel.

Solution: BrainRunner does NOT need the transport directly. The FUP scheduler generates a message
and needs to deliver it to the lead. The simplest approach for v1.4:

**FUP sends messages by calling an outbound webhook or publishing to a dedicated RabbitMQ queue**
(separate from the inbound queue), configured via:
- `FUP_WEBHOOK_URL` — POST target for FUP messages (same format as inbound BrainEvent, reversed)
- `FUP_RABBITMQ_QUEUE` — queue name for FUP outbound messages

This decouples FUP from the existing transport instances. The FUP scheduler publishes a message
to an external system that then routes it to the lead (WhatsApp, CRM, etc.). This is consistent
with how events already work in this architecture.

**Alternative (simpler for v1.4):** FUP re-invokes the compiled LangGraph directly with a synthetic
"fup trigger" message (a HumanMessage with a special marker) using the lead's thread_id. The graph
runs as normal, generates a response via the LLM + FUP prompt, and the result is sent via the
event publisher. This avoids needing a separate outbound transport.

**Recommended for v1.4: the LangGraph re-invocation approach**

```
FupScheduler.tick():
  SELECT leads WHERE fup_enabled=true AND fup_next_at <= NOW() AND ia_ativada=true LIMIT 10
  For each lead:
    1. Check time window (allowedHours, allowedDays, timezone) → skip if outside window
    2. Build synthetic event: { Name, Message: "[FUP_TRIGGER]", Numero, IDLead: lead.uniqueId }
    3. compiledGraph.invoke({ messages: [HumanMessage("[FUP_TRIGGER:step=N]")], ... },
                             { configurable: { thread_id: lead.uniqueId } })
       → LLM receives conversation history + FUP system prompt → generates follow-up
    4. Extract brainOutput from result
    5. Publish via outbound webhook/queue (TOOL_EVENTS channel or FUP-specific channel)
    6. UPDATE leads SET fup_step=N+1, fup_next_at=NOW()+interval[N+1] (or fup_enabled=false if last step)
    7. UPDATE leads SET last_message_at=NOW()
```

**Scheduler interval:** configured via `FUP_CHECK_INTERVAL_MS` (default: 30 seconds). This is NOT
the FUP message interval (that is in fup_config.intervals) — this is how often the scheduler polls.

### FUP Scheduler Access to compiledGraph

The scheduler needs to invoke the same compiledGraph owned by BrainRunner. The cleanest approach:

**BrainRunner exposes a package-internal `runFup(lead)` method** that the FupScheduler calls.
This keeps compiledGraph private to BrainRunner and avoids coupling FupScheduler to LangGraph directly.

```typescript
// BrainRunner — new internal method (not exported in public API)
async runFup(lead: Lead, fupMessage: string): Promise<BrainOutput | null>
```

FupScheduler receives a reference to BrainRunner (passed in constructor). This is a minor coupling
but safer than exposing compiledGraph publicly.

### FUP Data Flow

```
setInterval(FupScheduler.tick, FUP_CHECK_INTERVAL_MS)
  ↓
SELECT leads WHERE fup_enabled=true AND fup_next_at <= NOW() LIMIT 10
  ↓ for each lead:
  Check time window (allowedHours, allowedDays, timezone via Intl.DateTimeFormat)
    → skip + reschedule fup_next_at to next valid window start if outside
  ↓
  BrainRunner.runFup(lead, "[FUP_TRIGGER:step=N lead={nome}]")
    → compiledGraph.invoke with FUP system prompt (loaded via FUP promptKey from fup_config)
    → LLM generates follow-up using conversation history + FUP prompt
    → brainOutput { fullResponse, responseMode }
  ↓
  toolEventPublisher.publish({ action: "fup_message", lead, result: brainOutput.fullResponse })
    → fires to TOOL_EVENTS_WEBHOOK_URL or TOOL_EVENTS_RABBITMQ_QUEUE
  ↓
  UPDATE leads SET fup_step=N+1, fup_next_at=NOW()+intervals[N+1]
  OR
  UPDATE leads SET fup_step=N+1, fup_enabled=false (if N+1 >= intervals.length)
  UPDATE leads SET last_message_at=NOW()
```

**Error handling:** FUP failures are non-fatal. Log error, DO NOT advance fup_step, let next tick retry.
After 3 consecutive failures for a lead, set `fup_enabled=false` to prevent infinite retry spam.

---

## Component Map: New vs. Modified

### New Components

| Component | Location | Description |
|-----------|----------|-------------|
| `knowledge_chunks` table | packages/database/src/schema/tables.ts | RAG knowledge storage |
| `fup_config` table | packages/database/src/schema/tables.ts | FUP rules per brainType |
| `leads.fupEnabled` col | packages/database/src/schema/tables.ts + migration | FUP opt-in |
| `leads.fupStep` col | packages/database/src/schema/tables.ts + migration | FUP step counter |
| `leads.fupNextAt` col | packages/database/src/schema/tables.ts + migration | Next FUP timestamp |
| `leads.lastMessageAt` col | packages/database/src/schema/tables.ts + migration | Last message timestamp |
| Migration `0007_*` | packages/database/src/migrations/ | knowledge_chunks + fup_config + leads cols |
| `packages/rag` | packages/rag/ | New package: ingest endpoint + search tool |
| `createRagApp(sql)` | packages/rag/src/server.ts | Hono sub-app: POST /api/v1/ingest |
| `createSearchKnowledgeTool(sql)` | packages/rag/src/tools/search-knowledge.ts | LangGraph tool |
| `packages/fup` | packages/fup/ | New package: FupScheduler class |
| `FupScheduler` | packages/fup/src/scheduler.ts | Background interval loop |
| `ToolEventPublisher` | packages/core/src/events/publisher.ts | Outbound event publisher |
| `createToolEventPublisher()` | packages/core/src/events/publisher.ts | Factory returning null if not configured |

### Modified Components

| Component | Location | Change |
|-----------|----------|--------|
| `BrainBuildContext` | packages/core/src/brain/interface.ts | Add `ragTools`, `toolEventPublisher?` |
| `BrainRunner._compileGraph()` | packages/core/src/runner/runner.ts | Create publisher + ragTools; inject into ctx |
| `BrainRunner.init()` | packages/core/src/runner/runner.ts | Start FupScheduler if FUP_ENABLED=true |
| `BrainRunner.run()` | packages/core/src/runner/runner.ts | Call `LeadService.touchLastMessage()` after turn |
| `BrainRunner.close()` | packages/core/src/runner/runner.ts | Stop FupScheduler on SIGTERM |
| `BrainRunner` (new method) | packages/core/src/runner/runner.ts | Add `runFup(lead, message): Promise<BrainOutput|null>` |
| `createPauseSessionTool()` | packages/core/src/tools/pause-session.ts | Accept optional publisher; fire event after DB update |
| `createFinishConversationTool()` | packages/core/src/tools/finish-conversation.ts | Accept optional publisher; fire event after DB update |
| `LeadService` | packages/core/src/leads/lead-service.ts | Add `touchLastMessage(uniqueId)`, `getFupCandidates()` |
| `createServer()` (both Brains) | apps/brain-sdr/src/server.ts, apps/brain-echo/src/server.ts | Mount `createRagApp(sql)` |
| `brain.buildGraph()` (both Brains) | apps/brain-sdr/src/brain.ts, apps/brain-echo/src/brain.ts | Spread `ctx.ragTools` into `bindTools()` and `ToolNode` |
| Migration journal | packages/database/src/migrations/meta/ | Add entry for 0007 migration |

---

## Dependency Graph for the Three Features

```
Feature 1 (RAG):
  packages/rag
    depends on: packages/database (schema), packages/ai (createEmbeddings), packages/observability
    consumes: existing sql (Sql) from BrainRunner context
    touches: BrainBuildContext (add ragTools), createServer() in each Brain

Feature 2 (Tool Events):
  packages/core/src/events/publisher.ts
    depends on: packages/shared (types), packages/observability (logger)
    touches: BrainBuildContext (add toolEventPublisher), tool factories (pass publisher)

Feature 3 (FUP):
  packages/fup
    depends on: packages/database (schema, LeadService), packages/core (BrainRunner.runFup),
                packages/observability, packages/shared
    touches: BrainRunner.init() (start scheduler), BrainRunner.run() (touchLastMessage),
             leads table (new columns), fup_config table (new)
  FUP also re-uses Feature 2 (tool events) to send the generated FUP message outbound
```

---

## Build Order (Phase Sequencing)

**Rationale for order:**

1. DB migrations are foundational — all features need their tables/columns before anything else can run.
   Add all new columns and tables in one migration (0007) to minimize migration round-trips.

2. Tool Events (Feature 2) is the simplest feature and has no deps on RAG or FUP.
   Build it second — it pays off immediately (existing tools start publishing events) and
   its IToolEventPublisher interface is reused by FUP.

3. RAG (Feature 1) is independent of Tool Events and FUP. Build it third.
   The ingest endpoint and search tool are self-contained within packages/rag.
   Once built, it is injected into BrainBuildContext and available to all Brains.

4. FUP (Feature 3) is the most complex. It depends on:
   - The new DB columns (needs migration — done in phase 1)
   - `lastMessageAt` being updated by BrainRunner.run() (minor run() change)
   - IToolEventPublisher interface for outbound message delivery (done in feature 2 phase)
   FUP is built last when all dependencies are in place.

**Suggested Phase Structure:**

```
Phase A: Database foundation
  - Add knowledge_chunks table, fup_config table, new leads columns to tables.ts
  - Write migration 0007
  - Export knowledgeChunks, fupConfig from packages/database
  - Add LeadService.touchLastMessage() and LeadService.getFupCandidates()
  - Add BrainRunner.run() → touchLastMessage() call

Phase B: Tool Events
  - packages/core/src/events/publisher.ts (createToolEventPublisher, IToolEventPublisher)
  - Modify createPauseSessionTool() + createFinishConversationTool() to accept publisher
  - Add toolEventPublisher to BrainBuildContext + BrainRunner._compileGraph()
  - ENV: TOOL_EVENTS_WEBHOOK_URL, TOOL_EVENTS_RABBITMQ_QUEUE

Phase C: RAG
  - Create packages/rag with createRagApp() and createSearchKnowledgeTool()
  - Add ragTools to BrainBuildContext
  - BrainRunner._compileGraph() creates ragTools from KNOWLEDGE_COLLECTIONS env
  - Mount createRagApp(sql) in apps/brain-sdr + apps/brain-echo createServer()
  - Spread ragTools in both Brain buildGraph() (bindTools + ToolNode)
  - ENV: KNOWLEDGE_COLLECTIONS, INGEST_TOKEN

Phase D: FUP Automático
  - Create packages/fup with FupScheduler
  - Add BrainRunner.runFup() internal method
  - BrainRunner.init() starts FupScheduler if FUP_ENABLED=true
  - BrainRunner.close() stops scheduler on SIGTERM
  - Seed fup_config via SQL migration or /reload-prompts extension
  - ENV: FUP_ENABLED, FUP_CHECK_INTERVAL_MS
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reusing `embeddings` table for RAG knowledge chunks
**Why bad:** The embeddings table is scoped by (userId, sessionId) — mixing domain knowledge into
conversation memory pollutes the isolation boundary, breaks the HNSW index efficiency (cross-userId
scans), and creates semantic confusion for future developers.
**Instead:** New `knowledge_chunks` table with `collection` column as the namespace.

### Anti-Pattern 2: LangGraph callbacks for event publishing
**Why bad:** Callbacks (LCEL callbacks, dispatchCustomEvent) are for tracing/observability, not
for side-effect triggering. They have async completion semantics that are less predictable.
**Instead:** Tool factory accepts publisher as optional argument; publisher.publish() called inside
the tool implementation after the side-effect (DB update).

### Anti-Pattern 3: FUP scheduler as a separate process or container
**Why bad:** Adds operational complexity (separate Docker service, separate DB connection pool,
process coordination). The Brain already has the compiled LangGraph and SQL connection.
**Instead:** FupScheduler runs inside the same BrainRunner process, started by init(), stopped
by close(). No new infrastructure.

### Anti-Pattern 4: FUP duplicating LangGraph graph construction
**Why bad:** FUP would need its own LLM + tools + checkpointer — duplicating what BrainRunner
already manages. This creates drift between FUP behavior and normal conversation behavior.
**Instead:** BrainRunner.runFup() reuses the same compiledGraph. FUP is just a synthetic trigger
message with a special FUP system prompt layered in.

### Anti-Pattern 5: Spreading ragTools only in brain-sdr (not in core)
**Why bad:** Every new Brain would need to remember to spread ragTools — violates the "add once,
works everywhere" principle of the SDK.
**Instead:** ragTools is part of BrainBuildContext. Both brain-sdr and brain-echo must spread it
in their buildGraph(). Document this in IBrain contract. Alternatively, consider whether BrainRunner
could inject ragTools into ToolNode automatically — but this conflicts with the current design where
Brain owns its own graph wiring.

### Anti-Pattern 6: FUP sending messages via BrainEvent → transport inbound queue
**Why bad:** Sending to the Brain's own inbound queue creates a circular dependency (Brain sends
to itself) and pollutes the inbound queue with synthetic events mixed with real user messages.
**Instead:** FUP publishes to a dedicated outbound channel (TOOL_EVENTS publisher) that an external
system (n8n, WhatsApp gateway) routes to the lead.

---

## Scalability Considerations

| Concern | v1.4 (single Brain instance) | Future |
|---------|------------------------------|--------|
| Ingest throughput | Synchronous chunking in request handler; acceptable for <1000 docs | Async ingest queue if needed |
| knowledge_chunks scan | HNSW index covers cosine search; collection index covers filter | Partition by collection if >1M rows |
| FUP scheduler multi-instance | Multiple Brain instances all poll the same leads — race condition risk | Add `fup_locked_until` column for optimistic lock, or leader election |
| Tool events ordering | Fire-and-forget per tool; no ordering guarantee | Add sequence number if consumer needs ordering |

**Critical for v1.4:** The FUP multi-instance race (multiple instances scheduling the same lead's
FUP at the same time) should be mitigated with a simple `UPDATE leads SET fup_next_at = fup_next_at + interval '30 seconds' WHERE unique_id = ? AND fup_next_at <= NOW() RETURNING *` optimistic-lock pattern.
Only the instance that successfully updates and gets a RETURNING row proceeds. All others skip.

---

## Sources

- All findings based on direct codebase read (HIGH confidence):
  - /root/Brain/packages/core/src/runner/runner.ts
  - /root/Brain/packages/core/src/brain/interface.ts
  - /root/Brain/packages/core/src/server.ts
  - /root/Brain/packages/core/src/tools/pause-session.ts
  - /root/Brain/packages/core/src/tools/finish-conversation.ts
  - /root/Brain/packages/core/src/leads/lead-service.ts
  - /root/Brain/packages/database/src/schema/tables.ts
  - /root/Brain/packages/database/src/migrate.ts
  - /root/Brain/packages/ai/src/graph/state.ts
  - /root/Brain/packages/ai/src/embeddings/factory.ts
  - /root/Brain/packages/memory/src/semantic.ts
  - /root/Brain/packages/transport/src/factory.ts
  - /root/Brain/packages/transport/src/webhook/handler.ts
  - /root/Brain/packages/transport/src/rabbitmq/consumer.ts
  - /root/Brain/apps/brain-sdr/src/brain.ts
  - /root/Brain/apps/brain-sdr/src/server.ts
  - /root/Brain/.planning/PROJECT.md
