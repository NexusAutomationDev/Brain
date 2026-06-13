# Architecture: Brain Core v1.1 Integration

**Domain:** AI agent platform monorepo — adding RabbitMQ transport, leads schema, Brain SDR
**Researched:** 2026-06-13
**Overall confidence:** HIGH — based on direct codebase analysis of all v1.0 source files

---

## Existing Architecture (v1.0 Baseline)

```
apps/
  brain-echo/
    src/
      index.ts       ← startup: migrations → runner.init() → Bun.serve()
      brain.ts       ← IBrain impl (echoBrain, brainType="echo")
      server.ts      ← composes 3 Hono sub-apps via app.route('/')

packages/
  shared/            ← BrainError, ConfigurationError (no dep on anything)
  database/          ← schema (users, memories, agent_state, embeddings, prompts)
                        TenantPoolManager, runMigrations()
  observability/     ← createLogger (Pino), createHealthApp, createTracingCallbacks
  ai/                ← BrainStateAnnotation, createCheckpointer, createLLM, createEmbeddings
  memory/            ← MemoryManager (long-term + short-term + semantic layers)
  transport/         ← ITransport, BrainEvent/BrainEventSchema, WebhookTransport,
                        createWebhookApp(), createTransport() factory
  core/              ← IBrain, BrainRunner, BrainRegistry, ToolsRegistry,
                        createCoreApp() (/reload-prompts)
```

**Dep graph (direction = "imports"):**
```
apps/* → core → ai, memory, transport, database, observability, shared
transport → shared
database → (drizzle, postgres.js only — no Brain packages)
shared → (nothing)
observability → shared
```

**Critical gap (GAP-1):** `WebhookTransport.start()` calls `createWebhookApp()` with no runner — the class is currently unused in production. `brain-echo/server.ts` bypasses it by calling `createWebhookApp(runner)` directly.

**Current BrainEvent schema (events.ts):**
```typescript
{ conversationId, stepIndex, userId, content, metadata? }
```
Must become `{ Name, Message, Numero, IDLead }` for v1.1 to match the standardized external contract.

---

## New Components

### 1. `packages/transport/src/rabbitmq/` — RabbitMQ Transport

New directory parallel to `webhook/` inside the existing `transport` package. Does NOT need a new package.

**Files to create:**
- `transport/src/rabbitmq/handler.ts` — `RabbitMQTransport` class implementing `ITransport`

**Interface contract:**
```typescript
// Runner is constructor-injected, not start()-injected.
// The runner is always known at startup; start() is just about opening the channel.
class RabbitMQTransport implements ITransport {
  constructor(
    private runner: IBrainRunnerLike,
    private leadGate: ILeadGate
  ) {}

  async start(): Promise<void> {
    // 1. amqplib-bun connect via RABBITMQ_URL env
    // 2. channel.assertQueue(RABBITMQ_QUEUE, { durable: true })
    // 3. channel.prefetch(1)  ← one message at a time per consumer
    // 4. channel.consume(queue, this._onMessage.bind(this))
  }

  async stop(): Promise<void> {
    // channel.close() then connection.close()
  }

  private async _onMessage(msg): Promise<void> {
    // parse JSON → validate with BrainEventSchema
    // → leadGate.resolveAndCheck() → ia_ativada gate
    // → runner.run(event)
    // → ack on success, nack on failure (see Data Flow section)
  }
}
```

**Required ENV:** `RABBITMQ_URL`, `RABBITMQ_QUEUE`

### 2. `packages/transport/src/runner-contract.ts` — Shared Duck-Type Interface

Promotes `IBrainRunnerLike` (currently local to `webhook/handler.ts`) to a shared location so both webhook and rabbitmq handlers can import it without duplication — and without creating a dep on `core`.

```typescript
// transport/src/runner-contract.ts
export interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{ reply: string }>;
}
```

### 3. `packages/transport/src/lead-gate.ts` — Lead Gate Interface

Defines the interface that `transport` handlers use to check leads, without importing from `core`. This preserves the dep direction (`core → transport`, never `transport → core`).

```typescript
// transport/src/lead-gate.ts
export interface ILeadGate {
  /**
   * Upsert lead on first contact. Returns { skip: true } if ia_ativada=false.
   */
  resolveAndCheck(input: {
    uniqueId: string;
    numero: string;
    nome?: string;
  }): Promise<{ skip: boolean }>;
}
```

`LeadService` in `core` satisfies this interface structurally (duck typing) — no explicit `implements ILeadGate` declaration needed.

### 4. `packages/database/src/schema/leads.ts` — Leads Table

New file in the existing `database` package schema directory. The existing `users` table is NOT modified or deleted — `memories.userId` is a plain `text` column (not an FK), so there is no dependency to break.

```typescript
// database/src/schema/leads.ts
import { pgTable, text, uuid, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  unique_id: text('unique_id').notNull(),       // app-generated, stable external ID
  nome: text('nome'),
  numero: text('numero').notNull(),
  ia_ativada: boolean('ia_ativada').notNull().default(true),
  fullpp: boolean('fullpp').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueIdIdx: uniqueIndex('leads_unique_id_idx').on(table.unique_id),
  numeroIdx: index('leads_numero_idx').on(table.numero),
}));
```

**`unique_id` semantics:** Application-generated on first contact (e.g., `IDLead` value from the transport message). The DB receives it as a plain string — no `defaultRandom()`. This is the stable external identifier used to link thread_id in LangGraph checkpoints.

**`ia_ativada` semantics:** `true` = Brain processes messages for this lead. `false` = human has taken over; Brain skips without calling the LLM. This check happens in the transport handler before `runner.run()`, not inside the LangGraph graph.

### 5. `packages/core/src/leads/service.ts` — LeadService

New module in the existing `core` package. Encapsulates all lead DB operations so neither the transport handlers nor the Brain graph reach raw SQL directly.

```typescript
// core/src/leads/service.ts
export class LeadService {
  constructor(private db: PostgresJsDatabase) {}

  async findByUniqueId(uniqueId: string): Promise<Lead | null> { ... }

  /**
   * Upsert on first contact. Idempotent via onConflictDoUpdate.
   * Satisfies ILeadGate.resolveAndCheck() structurally.
   */
  async resolveAndCheck(input: {
    uniqueId: string; numero: string; nome?: string;
  }): Promise<{ skip: boolean }> {
    const lead = await this._upsert(input);
    return { skip: !lead.ia_ativada };
  }

  private async _upsert(input): Promise<Lead> { ... }
}
```

**Dep direction:** `core` → `database` (already exists). No new dep edges introduced.

### 6. `apps/brain-sdr/` — Brain SDR Application

New app parallel to `brain-echo`. Same structure:

```
apps/brain-sdr/
  src/
    index.ts      ← startup sequence (see Build Order section)
    brain.ts      ← IBrain impl (sdrBrain, brainType="sdr")
    server.ts     ← Hono sub-apps composer (health + webhook + core)
  Dockerfile
  package.json
```

**`brain.ts` key differences from `brain-echo`:**
- `brainType: "sdr"`
- `promptKeys: ["system", "qualification_prompt"]` (minimum; extend as needed)
- `tools: [...]` — SDR-specific tools (e.g., lead lookup, calendar, CRM integration)
- `buildGraph()` — graph with context injection from leads layer and conditional routing

**`index.ts` key differences:**
- Creates `LeadService(db)`
- Calls `createTransport(runner, leadService)` (updated factory signature)
- Uses `transport.start()` instead of calling `createWebhookApp` directly

---

## Modified Components

### 1. `packages/transport/src/webhook/events.ts` — BrainEvent Schema

**Change:** Replace field names with v1.1 standardized contract.

**Current:**
```typescript
{ conversationId, stepIndex, userId, content, metadata? }
```

**New:**
```typescript
export const BrainEventSchema = z.object({
  Name:    z.string().min(1),    // lead's display name
  Message: z.string().min(1),   // message content
  Numero:  z.string().min(1),   // phone number (secondary lookup key)
  IDLead:  z.string().min(1),   // unique_id — primary lead identifier
});
export type BrainEvent = z.infer<typeof BrainEventSchema>;
```

**Downstream mapping in `BrainRunner.run()`:**
```
event.IDLead  → threadId (LangGraph thread_id + PostgresSaver checkpoint key)
event.Numero  → userId (MemoryManager long-term profile isolation)
event.Message → graph input content
event.Name    → available in state for personalization
```

This is the only place the external field names are mapped to internal concepts. Everything downstream uses `threadId` / `userId`.

### 2. `packages/transport/src/webhook/handler.ts` — WebhookTransport Fix (GAP-1)

**Change:** Runner and lead gate injected at construction, not at `start()`.

**Current (broken — runner never injected via class):**
```typescript
export class WebhookTransport implements ITransport {
  async start(port = 3000): Promise<void> {
    const app = createWebhookApp();  // no runner → fallback path only
    ...
  }
}
```

**Fixed:**
```typescript
export class WebhookTransport implements ITransport {
  constructor(
    private runner: IBrainRunnerLike,
    private leadGate?: ILeadGate   // optional for brain-echo backward compat
  ) {}

  async start(port = 3000): Promise<void> {
    const app = createWebhookApp(this.runner, this.leadGate);
    this.server = Bun.serve({ port, fetch: app.fetch });
  }
}
```

**Lead gate in `createWebhookApp()`** — add gate between parse and `runner.run()`:
```typescript
// After BrainEventSchema.safeParse(body) succeeds:
if (leadGate) {
  const { skip } = await leadGate.resolveAndCheck({
    uniqueId: event.IDLead,
    numero: event.Numero,
    nome: event.Name,
  });
  if (skip) {
    return c.json({ status: "skipped", reason: "ia_ativada=false" }, 200);
  }
}

const result = await runner.run(event);
```

`leadGate` is optional so `brain-echo` tests pass without a LeadService.

### 3. `packages/transport/src/factory.ts` — createTransport()

**Change:** Accept runner and optional leadGate as parameters.

**Current:**
```typescript
export function createTransport(transport?: string): ITransport {
  switch (type) {
    case "webhook": return new WebhookTransport();  // broken — no runner
    ...
  }
}
```

**New:**
```typescript
export function createTransport(
  runner: IBrainRunnerLike,
  leadGate?: ILeadGate,
  transport?: string
): ITransport {
  const type = transport ?? process.env.TRANSPORT ?? "webhook";
  switch (type) {
    case "webhook":  return new WebhookTransport(runner, leadGate);
    case "rabbitmq": return new RabbitMQTransport(runner, leadGate);
    default: throw new ConfigurationError(`Unknown TRANSPORT: ${type}`, { transport: type });
  }
}
```

### 4. `packages/transport/src/index.ts` — Barrel Exports

Add exports for:
- `RabbitMQTransport`
- `IBrainRunnerLike` (from runner-contract.ts)
- `ILeadGate` (from lead-gate.ts)

### 5. `packages/database/src/schema/tables.ts` — Add leads import

Import `leads` from the new `leads.ts` file and re-export it so the existing barrel picks it up. Alternatively, update `database/src/index.ts` directly to export from `schema/leads.ts`.

### 6. `packages/core/src/index.ts` — Export LeadService

Add `export { LeadService } from "./leads/service.js"`.

### 7. `packages/core/src/runner/runner.ts` — BrainEvent field mapping

`BrainRunner.run()` currently reads `event.conversationId` and `event.userId`. After the schema change:

```typescript
// Current
const threadId = event.conversationId;
// ...pass event.userId to memory layer

// New
const threadId = event.IDLead;
const userId = event.Numero;
```

This is the only change to `runner.ts` for v1.1 — no structural change to the lifecycle.

---

## Data Flow Diagrams (Text)

### Webhook Path (v1.1)

```
HTTP POST /api/v1/webhook  {Name, Message, Numero, IDLead}
  │
  ├── X-Request-Id missing → 400
  ├── Duplicate X-Request-Id → 409
  ├── Invalid JSON → 400
  ├── BrainEventSchema.safeParse() fails → 400
  │
  ▼ valid event
[ILeadGate].resolveAndCheck({ IDLead, Numero, Name })
  │  INSERT INTO leads ... ON CONFLICT (unique_id) DO UPDATE
  │
  ├── ia_ativada = false → 200 { status: "skipped" }
  │
  ▼ ia_ativada = true
[BrainRunner].run(event)
  │  threadId = IDLead
  │  userId   = Numero
  │
  ├── MemoryManager.getContext(threadId, userId, [])
  │     ├── readProfile(db, userId, "context")        → memories table
  │     ├── getCheckpoint(checkpointer, threadId)     → PostgresSaver (PG)
  │     └── semantic search skipped (queryVector=[])
  │
  ├── compiledGraph.invoke(
  │     { messages: [human: Message], userId: Numero, sessionId: IDLead },
  │     { configurable: { thread_id: IDLead } }
  │   )
  │     └── Brain graph nodes run (LLM, tools, etc.)
  │         PostgresSaver auto-saves checkpoint after invoke
  │
  └── MemoryManager.saveContext({ userId: Numero, ... })
        └── writeProfile(db, Numero, "context", { lastReply, conversationId: IDLead })
  │
  ▼
HTTP 200 { status: "ok", reply: "<llm response>" }
```

### RabbitMQ Path (v1.1)

```
RabbitMQ queue (RABBITMQ_QUEUE)
  │
  ▼ msg received
JSON.parse(msg.content.toString())
  │
  ├── parse error or BrainEventSchema fails
  │     → channel.nack(msg, false, false)  ← dead-letter, no requeue
  │
  ▼ valid event
[ILeadGate].resolveAndCheck({ IDLead, Numero, Name })
  │
  ├── ia_ativada = false
  │     → channel.ack(msg)  ← consumed silently, no runner call
  │
  ▼ ia_ativada = true
[BrainRunner].run(event)
  │
  ├── success
  │     → channel.ack(msg)
  │     (no HTTP response — fire-and-process; reply goes nowhere in v1.1)
  │
  └── transient error (DB down, LLM timeout, etc.)
        → channel.nack(msg, false, true)  ← requeue once for retry
```

**Note:** In v1.1, RabbitMQ is consume-only. The Brain does not publish a reply back to any queue. This avoids the large-message publishing issue (amqplib-bun Bun #5627). If reply publishing is added later, message size must be bounded.

### Brain SDR Startup Sequence

```
main() — apps/brain-sdr/src/index.ts

1. Validate DATABASE_URL env → exit(1) if missing

2. postgres(DATABASE_URL) → sql

3. runMigrations(sql, MIGRATIONS_DIR)
     ├── CREATE EXTENSION IF NOT EXISTS vector
     ├── Drizzle migrations (includes leads table from v1.1 migration)
     └── exit(1) on failure

4. new ToolsRegistry()
   toolsRegistry.registerBrainType("sdr")
   toolsRegistry.enableTool("sdr", "<tool-name>")  // per SDR tool list

5. new BrainRunner({ brain: sdrBrain, sql, toolsRegistry })
   await runner.init()
     ├── loadPrompts(sql, "sdr", ["system", "qualification_prompt"])
     ├── exit(1) if any promptKey missing from DB
     └── _compileGraph() → PostgresSaver + LLM + filtered tools

6. const db = drizzle(sql)
   const leadService = new LeadService(db)

7. const transport = createTransport(runner, leadService, process.env.TRANSPORT)
     → new WebhookTransport(runner, leadService)   if TRANSPORT=webhook
     → new RabbitMQTransport(runner, leadService)  if TRANSPORT=rabbitmq

8. await transport.start(PORT)
     → Bun.serve() or channel.consume()

9. logger.info("brain-sdr ready")
```

### Lead-to-Thread Binding (Conversation History)

```
Incoming message: IDLead = "lead-abc-123"

LangGraph thread_id = "lead-abc-123"
  └── PostgresSaver checkpoint key = "lead-abc-123"
      → All turns for this lead share one checkpoint
      → Full message history restored automatically on next invoke
      → No extra query or storage code needed

Memory userId = Numero (e.g., "+5511999999999")
  └── memories table: WHERE user_id = '+5511999999999' AND key = 'context'
      → Stores structured profile data across all sessions
      → Independent of LangGraph checkpoint

Result: Conversation history across sessions is automatic.
The only "new code" is passing event.IDLead as thread_id.
```

---

## Build Order

Dependencies run in this order. Each step is a dependency gate for the next.

### Step 1 — BrainEvent Schema + Transport Infrastructure (no external deps)

**Scope (all within `packages/transport`):**
- Rewrite `webhook/events.ts` (new field names: Name, Message, Numero, IDLead)
- Create `runner-contract.ts` (promote `IBrainRunnerLike`)
- Create `lead-gate.ts` (new `ILeadGate` interface)
- Fix `WebhookTransport` constructor injection (GAP-1)
- Update `createWebhookApp()` to accept optional `ILeadGate`
- Update `createTransport()` signature (runner + leadGate + type)
- Update `index.ts` barrel exports

**Why first:** Every downstream component (BrainRunner field mapping, LeadService interface, RabbitMQ handler) depends on the canonical BrainEvent shape. Fixing GAP-1 is zero-risk (internal to transport) and unblocks everything else.

**Tests to update in the same PR:** `webhook.test.ts` in brain-echo (field names changed), `factory.test.ts`, `handler.test.ts`

### Step 2 — Leads Schema + Drizzle Migration (depends on Step 1: none; but logically before Step 3)

**Scope (within `packages/database`):**
- Create `schema/leads.ts`
- Update `schema/tables.ts` or `index.ts` to export leads
- Run `drizzle-kit generate` to create the migration SQL file
- Commit migration file alongside schema

**Why second:** LeadService (Step 3) imports from the leads schema. The migration file must be committed before any Brain starts up against a real DB.

**Important:** Do NOT delete `users` table. The `memories` table uses `userId: text('user_id')` (plain text, not FK), so removing `users` is harmless but unnecessary churn. Leave it for a deliberate deprecation later.

### Step 3 — LeadService (depends on Step 2)

**Scope (within `packages/core`):**
- Create `leads/service.ts`
- Update `core/src/index.ts` to export `LeadService`
- Unit tests with mocked Drizzle db

**Why third:** LeadService depends on the `leads` schema (Step 2). The transport handler will import `ILeadGate` (Step 1) and receive a `LeadService` instance via constructor. `BrainRunner` does NOT import LeadService — that dep stays in the transport handlers.

### Step 4 — RabbitMQ Transport (depends on Steps 1 and 3)

**Scope (within `packages/transport`):**
- Create `rabbitmq/handler.ts` (RabbitMQTransport class)
- Add `amqplib-bun` to transport package.json dependencies
- Update `factory.ts` (add rabbitmq case)
- Update `index.ts` (export RabbitMQTransport)
- Integration test against real RabbitMQ (via Docker Compose)

**Why fourth:** Depends on BrainEvent schema (Step 1) and ILeadGate (Step 1). Can be developed in parallel with Step 3 if LeadService interface is agreed first (it is — defined as ILeadGate in Step 1).

### Step 5 — BrainRunner Field Mapping Update (depends on Step 1)

**Scope (within `packages/core/src/runner/runner.ts`):**
- Replace `event.conversationId` with `event.IDLead` as threadId
- Replace `event.userId` with `event.Numero` as userId
- Update integration tests in `brain-runner.integration.test.ts`

**Why fifth (could be Step 2):** Strictly depends only on Step 1 (BrainEvent shape). Grouped here to minimize PR scope per step. Could be merged with Step 1 as one PR.

### Step 6 — Brain SDR App (depends on all previous steps)

**Scope (new `apps/brain-sdr/`):**
- Create package structure, Dockerfile, package.json
- `brain.ts` — IBrain with brainType="sdr", SDR-specific graph
- `server.ts` — Hono sub-apps composer
- `index.ts` — startup sequence using createTransport()
- SDR prompts seed (INSERT into prompts for brain_type="sdr")
- Integration tests for full message flow with a real lead

**Why last:** Brain SDR consumes everything. Any earlier step with a bug causes rework in SDR. The correct approach is to have a green test suite for Steps 1-5 before writing brain-sdr code.

---

## Architectural Risks

### Risk 1: BrainEvent Schema Break is a Hard Cut (HIGH)

Renaming `{ conversationId, stepIndex, userId, content }` to `{ Name, Message, Numero, IDLead }` is a breaking change. Any test, integration, or client that sends the old shape will get 400 errors after the change. The brain-echo integration tests in `__tests__/integration/webhook.test.ts` use the old field names.

**Mitigation:** Update all test fixtures in the same PR that changes `events.ts`. The monorepo makes this atomic. Do not accept a PR where the schema changes but tests still use old field names.

### Risk 2: Circular Dep Risk if LeadService Moves to Transport (HIGH)

If `transport/src/webhook/handler.ts` imports `LeadService` from `@brain-pkg/core`, it creates a cycle: `core → transport → core`. The existing `IBrainRunnerLike` duck-type was invented precisely to break this cycle.

**Mitigation:** `ILeadGate` interface lives in `packages/transport` (like `IBrainRunnerLike`). `LeadService` in `core` satisfies it structurally. Transport handlers never import from `core`. This is the correct pattern — do not break it.

### Risk 3: RabbitMQ Large Message Risk (MEDIUM, pre-existing)

`amqplib-bun` fixes connection issues but the "invalid frame" bug (Bun issue #5627) may surface for large messages. SDR messages are short (WhatsApp text), but if a future version publishes LLM responses back to RabbitMQ, payload sizes could trigger this.

**Mitigation:** For v1.1, RabbitMQ is consume-only. Brain does not publish replies back to any queue. This avoids the bug entirely. If publish is added later, cap message size in the publisher or move to a PG LISTEN/NOTIFY channel for reply routing.

### Risk 4: `unique_id` Concurrent Upsert Race (LOW)

If two messages from the same lead arrive simultaneously before the first upsert commits, the second insert hits the unique constraint on `unique_id`. Without conflict handling this is a 500.

**Mitigation:** Use `onConflictDoUpdate` (same pattern as `memories` table upsert in `long-term.ts`). Both concurrent paths converge to the same row with no error. This is the existing Drizzle upsert pattern — follow it exactly.

### Risk 5: TenantPoolManager Still Inactive (MEDIUM)

Per `PROJECT.md`, TenantPoolManager is in scope for v1.1 activation. But brain-sdr's `index.ts` will likely start with `postgres(DATABASE_URL)` directly (same as brain-echo). Activating TenantPoolManager mid-build is a distraction that risks delaying SDR delivery.

**Mitigation:** Build brain-sdr with direct `postgres(DATABASE_URL)` first. Activate TenantPoolManager as a targeted sub-task isolated from SDR work. The interface is `Sql` either way — the swap is a one-line change in `index.ts`. Flag this as a separate task in the roadmap, not blocked by SDR.

### Risk 6: Migration File for `leads` Must Be Committed (MEDIUM)

Drizzle uses a `migrations/` folder of SQL files generated by `drizzle-kit generate`. If the schema file is committed without running the generator, the runtime `runMigrations()` call will not create the `leads` table (the migration file is missing), and LeadService will fail with a "relation does not exist" error at runtime.

**Mitigation:** The PR that adds `schema/leads.ts` must also include the generated migration file (`packages/database/src/migrations/000X_leads.sql`). Add this to the PR checklist. Consider a CI check that validates the migration files are in sync with the schema.

---

## Component Boundary Summary

| Component | Package | Status | Imports From |
|-----------|---------|--------|--------------|
| `BrainEvent` (Name/Message/Numero/IDLead) | transport | MODIFIED | zod |
| `IBrainRunnerLike` (runner-contract.ts) | transport | NEW | transport/events |
| `ILeadGate` (lead-gate.ts) | transport | NEW | — |
| `WebhookTransport` (constructor injection) | transport | MODIFIED | transport |
| `createWebhookApp()` (+ leadGate param) | transport | MODIFIED | transport |
| `createTransport(runner, leadGate?, type?)` | transport | MODIFIED | transport |
| `RabbitMQTransport` | transport | NEW | transport, amqplib-bun |
| `leads` Drizzle table | database | NEW | drizzle-orm |
| `LeadService` | core | NEW | database, shared |
| `BrainRunner.run()` field mapping | core | MODIFIED | transport |
| `sdrBrain` IBrain implementation | apps/brain-sdr | NEW | ai, core |
| `apps/brain-sdr` startup + Dockerfile | apps/brain-sdr | NEW | all packages |

**Dep graph after v1.1 (no new dep edges):**
```
apps/* → core → ai, memory, transport, database, observability, shared
transport → shared              (unchanged)
database → (drizzle only)      (unchanged)
```
`ILeadGate` and `IBrainRunnerLike` live in `transport`, so `core → transport` remains the only cross-direction. No new cycles.

---

## Sources

- Direct codebase analysis: all files in `packages/transport/src/`, `packages/core/src/`, `packages/database/src/schema/`, `packages/memory/src/`, `apps/brain-echo/src/`
- `.planning/PROJECT.md`: v1.1 requirements, GAP-1 description, TenantPoolManager status
- `CLAUDE.md`: Stack constraints (Bun, Hono, Drizzle, LangGraph, amqplib-bun)
- Existing pattern reference: `IBrainRunnerLike` duck-type in `transport/src/webhook/handler.ts` (anti-circular technique)
- Existing pattern reference: Drizzle upsert with `onConflictDoUpdate` in `packages/memory/src/long-term.ts`
- Known risk reference: amqplib-bun Bun issue #5627 (documented in STACK.md and PROJECT.md)
