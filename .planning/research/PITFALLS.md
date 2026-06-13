# Domain Pitfalls

**Domain:** TypeScript AI Agent Platform (LangGraph + PostgreSQL/PGVector + Bun + Drizzle ORM, multi-tenant)
**Researched:** 2026-06-11 (v1.0) · Updated 2026-06-13 (v1.1 addendum)
**Overall confidence:** HIGH — all pitfalls verified against official docs, GitHub issues, or multiple production reports

---

## v1.1 Addendum: Integration Pitfalls

> These pitfalls are specific to adding RabbitMQ transport, leads schema (replacing users), and Brain SDR to the existing v1.0 system. Generic pitfalls from v1.0 are preserved below in their original sections. Do not repeat the known risks already documented (amqplib-bun, bun:sql driver, RabbitMQ 4.1.0 amqplib version requirement) — reference them inline only.

---

### INT-01: Unhandled Channel Closure Crashes the Bun Process

**Severity:** CRITICAL

**What goes wrong:** When a RabbitMQ connection drops (network blip, broker restart, broker-side timeout), amqplib emits an `error` event on the `Connection` object and a `close` event on the `Channel`. If no `error` listener is attached to either, Node.js/Bun throws `UnhandledPromiseRejection` and kills the process. Any in-flight LangGraph invocations at that moment are interrupted mid-graph — their PostgresSaver checkpoints are partially written, leaving the thread in an indeterminate state.

**Why it happens:** amqplib's event model requires explicit `connection.on('error', ...)` and `channel.on('error', ...)` listeners. There is no default swallowing. Bun's behavior matches Node.js: unhandled promise rejections crash the process in production mode.

**Warning signs:**
- Container exits with code 1 after a RabbitMQ restart or network event
- `UnhandledPromiseRejection: Channel ended` in logs
- Pino shows a clean startup followed by a sudden silence — no error log before exit
- PostgresSaver checkpoint rows with `created_at` matching the crash time but no corresponding `checkpoint_writes` row (truncated write)

**Prevention:**
```typescript
// REQUIRED pattern for RabbitMQ consumer in Bun
const conn = await amqp.connect(url);
conn.on('error', (err) => logger.error({ err }, 'RabbitMQ connection error'));
conn.on('close', () => { scheduleReconnect(); });

const ch = await conn.createChannel();
ch.on('error', (err) => logger.error({ err }, 'RabbitMQ channel error'));
ch.on('close', () => logger.warn({}, 'RabbitMQ channel closed'));

// prefetch = 1 ensures at-most-one in-flight message per consumer
// if the channel dies mid-process, only one message is re-queued
await ch.prefetch(1);
```
- Reconnection must be implemented in the `close` handler, not as a crash recovery — Bun Docker containers restart after a crash but lose the consumer tag, causing a 5-10s gap in message consumption
- The consumer tag returned by `ch.consume()` must be stored to enable graceful cancel before close

**Phase to address:** Phase 1 of v1.1 (RabbitMQ transport implementation). This must be implemented before any integration testing.

---

### INT-02: Message Not Acked After LangGraph Throws — Infinite Redelivery Loop

**Severity:** CRITICAL

**What goes wrong:** The consumer callback calls `runner.run(event)` which invokes LangGraph. If LangGraph throws (LLM API error, DB constraint error, recursion limit hit), the message is never acked or nacked. RabbitMQ keeps the message as "unacked" for the duration of the consumer's session. On channel close or reconnect, RabbitMQ redelivers it. If the error is deterministic (e.g., a malformed payload that LangGraph always rejects), this creates an infinite redelivery loop that saturates the consumer.

**Why it happens:** amqplib uses manual acknowledgement. If the code throws before `ch.ack(msg)` or `ch.nack(msg)`, the broker assumes the consumer is still processing. With `prefetch(1)`, the queue appears frozen — no new messages are delivered while one is "in-flight."

**Warning signs:**
- RabbitMQ management UI shows 1 "Unacked" message indefinitely
- New messages pile up in "Ready" state while consumer shows connected
- Same `IDLead` appears in logs multiple times within seconds after a reconnect
- `x-death` count on a message exceeds 1 (visible via message inspection in management UI)

**Prevention:**
```typescript
ch.consume(queue, async (msg) => {
  if (!msg) return; // consumer cancelled
  try {
    const event = parseAndValidate(msg.content);
    await runner.run(event);
    ch.ack(msg);
  } catch (err) {
    logger.error({ err }, 'Consumer processing error');
    // nack with requeue=false sends to DLX — do NOT requeue transient errors blindly
    // requeue=true only for known transient failures (network timeout, not parse errors)
    const isTransient = isTransientError(err);
    ch.nack(msg, false, isTransient);
  }
});
```
- Configure a Dead Letter Exchange (DLX) on the queue so permanently-failed messages land in a dead letter queue instead of being lost
- Log the full message payload on nack — dead letter queues are silent without logging
- `isTransientError` must NOT return true for payload parse failures — those must go to DLX immediately

**Phase to address:** Phase 1 of v1.1 (RabbitMQ transport). Implement DLX in the same phase as the consumer — never defer it.

---

### INT-03: BrainEvent Schema Mismatch Between Webhook and RabbitMQ Paths

**Severity:** HIGH

**What goes wrong:** The current `BrainEventSchema` uses `{ conversationId, stepIndex, userId, content, metadata }`. The v1.1 spec introduces external fields `{ Name, Message, Numero, IDLead }`. If the Webhook and RabbitMQ transports each have their own parsing logic, they can silently diverge: a field mapped in one transport is ignored in the other, and the BrainRunner receives inconsistent events. The SDR Brain is written against one contract; when a message arrives via the other transport, it silently operates with `userId = undefined` or `conversationId = undefined`.

**Why it happens:** It's tempting to write a separate Zod schema per transport to handle field name differences, then "translate" to BrainEvent. If the translation layer is tested with one transport but not the other, the bug ships silently.

**Warning signs:**
- `BrainRunner.run()` receives events where `userId` is the string `"undefined"` (coercion artifact)
- Leads are created with `unique_id = ""` or `numero = null` after a message via one transport
- LangGraph thread_id is undefined or constant (same checkpoint loaded for all users)

**Prevention:**
- Define a single canonical `IncomingMessage` type: `{ Name: string, Message: string, Numero: string, IDLead: string }`
- Write a single `normalizeToEvent(raw: IncomingMessage): BrainEvent` function used by BOTH transports
- The Zod validation schema for IncomingMessage is shared between webhook handler and RabbitMQ consumer
- Add an integration test that sends the same logical message via both transports and asserts the BrainRunner receives identical `BrainEvent` objects

**Phase to address:** Phase 1 of v1.1, when standardizing transport fields. The canonical schema must be defined before either transport implementation starts.

---

### INT-04: `users` Table Drop Breaks PostgresSaver If Foreign Keys Exist

**Severity:** HIGH

**What goes wrong:** Replacing `users` with `leads` via a Drizzle migration that drops the `users` table will fail if any Drizzle-managed table has a foreign key referencing `users.id`. More critically, the `agent_state` table in the current schema does not have a FK to `users` (verified in `0000_lyrical_scrambler.sql`), but the `memories` table uses `user_id TEXT` — which is a bare text column, not a FK. This means a DROP TABLE succeeds, but any application code that inserts into `memories` with a user_id referencing the old users.id format will silently persist orphaned rows.

**Additionally:** PostgresSaver creates its own tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) outside of Drizzle's migration system. These tables use `thread_id TEXT` — no FK to users. They are safe. But if v1.1 code passes `thread_id` values derived from the old `users.id` (UUID format), and v1.1 also introduces `leads.unique_id` (likely a different format), existing checkpoints from v1.0 tests become unreachable via the new `thread_id` derivation logic.

**Warning signs:**
- `ERROR: relation "users" does not exist` in migration log (FK constraint from another table)
- Old EchoBrain test conversations no longer reachable after migration (thread_id format changed)
- `memories` table contains rows with `user_id` in UUID format while new code looks up by `leads.unique_id`

**Prevention:**
- Before writing the migration, run: `SELECT conname, conrelid::regclass FROM pg_constraint WHERE confrelid = 'users'::regclass` — verify zero FKs reference `users`
- Migration strategy: ADD `leads` table first → backfill → switch app code → DROP `users` in a later migration (separate deploy)
- Document the `thread_id` format explicitly: `leads.unique_id` as the thread_id key. Add a migration comment explaining the mapping
- Clean `memories` table: decide whether existing memories (keyed by UUID user_id) are migrated or dropped — do not leave orphaned rows silently

**Phase to address:** Phase 2 of v1.1 (schema migration). Verify zero FKs before executing. The migration must be a two-step additive sequence, not a single DROP/CREATE.

---

### INT-05: `unique_id` Format Choice Creates Unintended thread_id Collisions

**Severity:** HIGH

**What goes wrong:** `leads.unique_id` will be used as the `thread_id` for LangGraph checkpoints (one conversation thread per lead). If `unique_id` is generated from external data (e.g., `IDLead` from the RabbitMQ message), two leads from different clients could have the same `IDLead` if the generating CRM does not guarantee global uniqueness. In a single-tenant database this is acceptable. In the multi-tenant model (1 DB per client), it is also safe — collisions would only occur within the same client's database. However, if Brain SDR is ever shared across clients in one database (even temporarily, during a migration), thread_ids will collide and conversations will be contaminated.

**A separate, more immediate risk:** If `unique_id` is app-generated (nanoid or UUID), the generation must happen on the FIRST upsert, not on every call. If two RabbitMQ messages arrive simultaneously for the same `Numero` (WhatsApp message retry), two concurrent INSERT attempts run simultaneously — without a proper UNIQUE constraint + ON CONFLICT clause, two rows are created for the same lead.

**Warning signs:**
- Two `leads` rows with the same `numero` after a load test
- LangGraph checkpoint for lead A contains messages addressed to lead B (cross-contamination)
- `SELECT COUNT(*) FROM leads WHERE numero = '+5511999999999'` returns > 1

**Prevention:**
```typescript
// Correct upsert pattern — single SQL statement, not SELECT-then-INSERT
await db.insert(leads)
  .values({ unique_id: nanoid(), nome: name, numero, ia_ativada: true })
  .onConflictDoUpdate({
    target: leads.numero,  // UNIQUE constraint on numero
    set: { nome: name }    // update name if changed
  });
// THEN fetch the persisted unique_id (may have been set on original insert)
const lead = await db.select().from(leads).where(eq(leads.numero, numero)).limit(1);
const threadId = lead[0].unique_id;
```
- Add `UNIQUE` constraint on `leads.numero` in the migration — not just in the Drizzle schema
- `unique_id` must be generated once at insert time and never overwritten by the upsert set clause

**Phase to address:** Phase 2 of v1.1 (leads schema) and Phase 3 of v1.1 (lead registration flow). The UNIQUE constraint and upsert pattern must be in place before the first message is processed in any environment.

---

### INT-06: `ia_ativada` Check Placed After Expensive Operations

**Severity:** HIGH

**What goes wrong:** If the `ia_ativada = false` check is performed AFTER memory retrieval, prompt loading, or LangGraph invocation, the system wastes resources and introduces latency on every message for leads that should be silently ignored. More critically, if the check is inside the LangGraph graph (as a node condition), the BrainRunner still invokes the graph, which creates a new checkpoint entry for a thread that should not have been processed. This pollutes the checkpoint table and slightly degrades the lead's context on re-activation.

**A race condition variant:** If `ia_ativada` is checked once at the start of the webhook/consumer handler, then a concurrent UPDATE sets `ia_ativada = false` mid-execution, the response is sent before the flag is honored. For SDR use cases (e.g., a human operator disabling the bot mid-conversation), this is an acceptable race with low impact. But if `ia_ativada = false` means "human is taking over," a response from the bot arriving after the flag is cleared causes confusion.

**Warning signs:**
- LangGraph checkpoint table grows with entries for leads where `ia_ativada = false`
- Average response latency does not decrease for inactive leads (check is too late in the pipeline)
- Duplicate responses in WhatsApp when operator takes over (race condition)

**Prevention:**
- Check `ia_ativada` as the FIRST operation after lead lookup, before any LangGraph invocation
- If `ia_ativada = false`, ack the RabbitMQ message immediately and return without invoking BrainRunner
- The check should be synchronous against the DB result, not a second query:
```typescript
const lead = await findOrCreateLead(numero, name);
if (!lead.ia_ativada) {
  ch.ack(msg);
  return; // no BrainRunner.run(), no checkpoint created
}
await runner.run(event);
ch.ack(msg);
```
- For the race condition: accept it as a known limitation in v1.1. Document that `ia_ativada` is eventually consistent with a window of one message round-trip.

**Phase to address:** Phase 3 of v1.1 (lead registration flow). The `ia_ativada` check placement must be reviewed in the flow design phase, not implementation.

---

### INT-07: `thread_id` Collision When Same Lead Messages From Two Channels Simultaneously

**Severity:** MEDIUM

**What goes wrong:** LangGraph's PostgresSaver uses `thread_id` as the primary isolation key. If `thread_id = leads.unique_id`, and the same lead sends a message via WhatsApp (RabbitMQ consumer) and via the webhook simultaneously (e.g., a CRM integration triggers a webhook while the WhatsApp message is in-flight), both invocations will call `compiledGraph.invoke({ ... }, { configurable: { thread_id: sameLeadId } })` concurrently. PostgresSaver uses PostgreSQL transactions for checkpoint writes, but there is a documented race condition in PostgresSaver (langgraphjs issue #2040) where concurrent invocations on the same thread_id can produce cross-contaminated state.

**Warning signs:**
- LangGraph responds with a reply that references context from a different conversation channel
- `checkpoint_writes` table shows overlapping timestamps for the same `thread_id`
- Lead receives two replies in rapid succession after sending one message

**Prevention:**
- For v1.1 scope: the system only has one active transport per deployment (`TRANSPORT` env var). Webhook and RabbitMQ do not both run simultaneously. This pitfall is deferred to when multi-transport is introduced.
- If multi-transport ever runs in the same process: use `thread_id = `${leads.unique_id}:${transportType}`` to namespace per channel
- Alternatively: use a per-lead mutex (Redis or PostgreSQL advisory lock) before invoking `compiledGraph.invoke()` — only one invocation per lead at a time

**Phase to address:** Phase 3 of v1.1 (conversation history). Document the single-transport constraint as a design assumption. Flag for v2 when multi-transport is activated.

---

### INT-08: Drizzle Migration Race Condition on Simultaneous Startup

**Severity:** MEDIUM

**What goes wrong:** The current `runMigrations()` implementation calls `migrate(db, { migrationsFolder })` with no locking mechanism. When multiple Brain SDR containers start simultaneously (e.g., Docker Compose scale, Kubernetes rolling update, or CI running two containers in parallel), each instance attempts to apply the same pending migrations at the same time. Drizzle tracks applied migrations in the `__drizzle_migrations` table, but the check-then-insert is not atomic. Two instances can both read "migration X not applied," both execute it, and one fails with a PostgreSQL duplicate key or unique constraint error.

**Why this is worse for v1.1:** The `leads` table migration (adding a new table, dropping `users`) is a multi-step migration that is not idempotent — running it twice on an already-migrated DB will fail or silently corrupt data.

**Warning signs:**
- `ERROR: relation "leads" already exists` in one container's startup log
- Container startup fails and Docker restarts it, causing the healthy container to now encounter a broken DB state
- `__drizzle_migrations` table has duplicate rows for the same migration file

**Prevention:**
- Use PostgreSQL advisory locks to serialize migration execution:
```typescript
export async function runMigrations(sql: Sql, migrationsFolder: string): Promise<void> {
  const db = drizzle(sql);
  // Advisory lock key: any consistent integer — use a hash of 'brain-migrations'
  await sql`SELECT pg_advisory_lock(7246842)`;
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await migrate(db, { migrationsFolder });
  } finally {
    await sql`SELECT pg_advisory_unlock(7246842)`;
  }
}
```
- **Important caveat:** Advisory locks are session-scoped and incompatible with PgBouncer transaction pooling mode. Since the stack uses `postgres.js` directly (not PgBouncer), this is safe for v1.1.
- Alternative (simpler, no locking): Run migrations as a one-time init container in Docker Compose/Kubernetes, not on every app startup. Only use the in-process migration for development convenience.

**Phase to address:** Phase 1 of v1.1 (auto-migrate startup). Implement the advisory lock before deploying multiple instances.

---

### INT-09: PostgresSaver `setup()` Called Concurrently With Drizzle Migrations

**Severity:** MEDIUM

**What goes wrong:** The current startup sequence is: `runMigrations()` → `runner.init()` → `_compileGraph()` → `createCheckpointer()` → `checkpointer.setup()`. PostgresSaver's `setup()` creates its own tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) using CREATE TABLE IF NOT EXISTS internally. This is safe in isolation. However, if multiple instances start simultaneously and all call `checkpointer.setup()` at the same time, PostgresSaver's internal setup (which uses `pg` directly, not the postgres.js Sql instance) can encounter the same race condition as Drizzle migrations.

**A documented real bug:** langgraphjs issue #2040 and PR #2494 show that concurrent `setup()` calls with the same connection string have produced "table already exists" errors that crash the instance.

**Warning signs:**
- `ERROR: relation "checkpoints" already exists` in startup log
- Container dies immediately after migrations succeed (dies in `runner.init()`)
- Only reproducible when two containers start within ~500ms of each other

**Prevention:**
- Since `checkpointer.setup()` is called inside `_compileGraph()` which is called inside `runner.init()`, and `runner.init()` is called AFTER `runMigrations()` (which holds the advisory lock), the timing window for the race is already narrow.
- Additionally, since `setup()` uses `CREATE TABLE IF NOT EXISTS`, duplicate calls are safe in PostgreSQL — the error is typically from a CREATE INDEX IF NOT EXISTS race, not the table itself.
- Practical mitigation: add a `try/catch` around `checkpointer.setup()` that ignores "already exists" errors and retries once after a 100ms delay. This is a known pattern in LangGraph production deployments.
- Long-term: call `checkpointer.setup()` once in the migration step rather than in every BrainRunner init.

**Phase to address:** Phase 1 of v1.1 (auto-migrate startup). The advisory lock in INT-08 reduces but does not eliminate this window.

---

### INT-10: SDR Context Window Overflow for Long Leads

**Severity:** MEDIUM

**What goes wrong:** LangGraph appends all messages to the state's `messages` array. Each `compiledGraph.invoke()` call loads the full checkpoint (all prior messages) and sends them to the LLM. For a lead who has been in conversation for 50+ turns, the messages array grows to exceed the LLM's context window (GPT-4o: 128K tokens; Claude Sonnet: 200K tokens). The LLM API returns a 400 error (`context_length_exceeded`), LangGraph throws, and the entire conversation thread becomes unresponsive — every subsequent message fails with the same error.

**Why this is worse than expected:** SDR conversations are typically longer than support conversations. A qualification flow (first contact → rapport → discovery → objection handling → close attempt) can span 30-80 messages over multiple days, with each message including role-play context and CRM data injected into the system prompt.

**Warning signs:**
- `Error: This model's maximum context length is 128000 tokens. Your messages have X tokens` in Langfuse traces
- A specific lead's thread consistently fails while others work fine
- The failing lead has had > 40 conversation turns

**Prevention:**
- Implement message trimming at the graph level using LangGraph's `trimMessages` utility:
```typescript
import { trimMessages } from '@langchain/core/messages';
// In the graph node, before LLM call:
const trimmed = await trimMessages(state.messages, {
  maxTokens: 90000,      // leave headroom for system prompt + response
  strategy: 'last',     // keep most recent messages
  tokenCounter: llm,    // use LLM's tokenizer for accurate counts
  includeSystem: true,  // always keep system prompt
  allowPartial: false,
});
```
- Implement a summarization node that triggers when messages exceed a token threshold: summarize the first 60% of the conversation into a single "conversation summary" message, then drop the original messages
- For the SDR use case, the summarization node should specifically preserve: lead qualification data, stated objections, and agreed next steps — these are more important than small talk

**Phase to address:** Phase 4 of v1.1 (Brain SDR implementation). Must be implemented before any real SDR conversation goes to production. Can be deferred from Phase 4 only if a hard limit on conversation turns is enforced instead.

---

### INT-11: WebhookTransport GAP-1 Still Latent After v1.1 Webhook Standardization

**Severity:** MEDIUM

**What goes wrong:** `WebhookTransport.start()` creates the Hono app via `createWebhookApp()` with NO runner injected. The class is in the codebase, exported, and satisfies `ITransport`. If v1.1 work standardizes the webhook fields (Name, Message, Numero, IDLead) and migrates `createWebhookApp()` to accept the new schema, but GAP-1 is not fixed simultaneously, anyone calling `new WebhookTransport().start()` via the `createTransport()` factory will silently get a webhook that accepts requests but never invokes the BrainRunner (returns `{ status: "accepted" }` forever with no LLM response).

**Why it happens:** The factory returns `new WebhookTransport()` but the runner injection happens in `brain-echo/src/index.ts` which bypasses the transport class entirely (uses `createWebhookApp(runner)` directly). The gap is invisible until someone uses the factory as documented.

**Warning signs:**
- POST to `/api/v1/webhook` returns `{ "status": "accepted" }` instead of `{ "status": "ok", "reply": "..." }`
- No entries in Langfuse/LangSmith — runner.run() was never called
- Health check passes, server is up, but all messages are silently dropped

**Prevention:**
- Fix GAP-1 as part of v1.1: `WebhookTransport` must accept a runner in its constructor and pass it to `createWebhookApp(runner)`
- The fix: `class WebhookTransport { constructor(private runner?: IBrainRunnerLike) {} async start(port = 3000) { const app = createWebhookApp(this.runner); ... } }`
- Update `createTransport()` factory to accept and pass the runner
- Add a test that creates a WebhookTransport via `createTransport()`, starts it, sends a POST, and asserts the response is `{ status: "ok" }` — not `{ status: "accepted" }`

**Phase to address:** Phase 1 of v1.1 (Webhook standardization / GAP-1 fix). This is a prerequisite for any field standardization work — fixing the field schema without fixing the runner injection means the webhook still doesn't call the Brain.

---

### INT-12: Docker Image Size Bloat From `amqplib-bun` and LangChain Deps

**Severity:** LOW

**What goes wrong:** brain-echo was 419MB. Brain SDR adds `amqplib-bun` and potentially additional LangChain tools. `@langchain/langgraph`, `@langchain/core`, and their transitive dependencies (particularly `@aws-sdk/*` pulled in by some LangChain tools, `zod`, `ml-matrix`) add 30-80MB. The multi-stage Dockerfile already strips devDependencies, but the `node_modules` COPY approach copies per-package `node_modules/` directories wholesale — including any packages that could be deduped but are not because of pnpm's hoisting strategy.

**Warning signs:**
- Brain SDR image exceeds 600MB
- Docker layer for `packages/ai/node_modules` or `packages/core/node_modules` exceeds 100MB
- Build time exceeds 5 minutes on CI

**Prevention:**
- Audit what `@aws-sdk/*` packages appear in the final image: `docker run brain-sdr find /app -name "package.json" -path "*/aws-sdk/*" | wc -l`. If > 0, find which LangChain package pulls them and consider a tree-shaking bundler step
- For the `amqplib-bun` package specifically: it is a fork of vanilla `amqplib` and adds minimal size overhead (< 5MB)
- The largest size contributor is the `@langchain/*` ecosystem — no direct mitigation without bundling. Accept 500-600MB as the realistic target for Brain SDR
- Use `docker history brain-sdr` to identify the largest layers and target those specifically
- Consider `bun build --compile` (single binary) for a future optimization: reduces image to ~50MB but requires all imports to be statically resolvable — incompatible with the current dynamic prompt loading approach

**Phase to address:** Phase 5 of v1.1 (Docker packaging). Profile the image after the Brain SDR implementation is complete, not before.

---

## Phase-Specific Warnings (v1.1)

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|------------|
| Phase 1 | RabbitMQ transport | INT-01: Unhandled channel closure crashes process | Attach error/close listeners; implement reconnection |
| Phase 1 | RabbitMQ transport | INT-02: Unacked message causes infinite redelivery | Always ack/nack in try/catch; configure DLX |
| Phase 1 | Webhook standardization | INT-11: GAP-1 still latent | Fix runner injection before field changes |
| Phase 1 | Auto-migrate startup | INT-08: Concurrent startup race condition | Add PostgreSQL advisory lock in runMigrations() |
| Phase 1 | Auto-migrate startup | INT-09: PostgresSaver setup() race | Add try/catch around setup(); consider moving to migration step |
| Phase 2 | Leads schema | INT-04: users table drop breaks FKs or orphans data | Verify zero FKs; use additive two-step migration |
| Phase 2 | Leads schema | INT-05: unique_id collision from concurrent upsert | Add UNIQUE on numero; use ON CONFLICT upsert pattern |
| Phase 3 | Lead registration flow | INT-06: ia_ativada check placed too late | Check before any LangGraph invocation |
| Phase 3 | Lead registration flow | INT-03: BrainEvent schema mismatch between transports | Single canonical IncomingMessage type + shared normalizer |
| Phase 3 | Conversation history | INT-07: Same lead via two channels simultaneously | Document single-transport assumption; defer multi-channel to v2 |
| Phase 4 | Brain SDR | INT-10: Context window overflow for long conversations | Implement trimMessages or summarization node before production |
| Phase 5 | Docker packaging | INT-12: Image size bloat from LangChain deps | Profile after SDR complete; accept 500-600MB as realistic target |

---

## Critical Pitfalls (v1.0 — preserved)

Mistakes that cause rewrites, data loss, or production outages.

---

### Pitfall 1: LangGraph State Serialization Failures

**What goes wrong:** Graph state containing non-JSON-serializable TypeScript/JavaScript types (`Set`, `Buffer`, `Date`, `Uint8Array`, custom class instances) throws at runtime during checkpointing, LangSmith tracing, or remote execution. The error is opaque — `TypeError: Object of type set is not JSON serializable` — and only surfaces when the checkpointer actually tries to persist.

**Why it happens:** LangGraph checkpoints serialize the entire state object to JSON for persistence, tracing, and resumability. JavaScript `Set` is the most common culprit — developers use it for deduplication (visited URLs, processed IDs) without realizing it's not JSON-serializable.

**Consequences:** Entire workflow crashes mid-execution. In production with a PostgresSaver, the thread is left in a broken state with no clean recovery path.

**Prevention:**
- Define state schemas with only JSON-safe primitives: use `string[]` instead of `Set<string>`, `Record<string, unknown>` instead of `Map`, ISO strings instead of `Date` objects
- Add a CI test that constructs every state type and calls `JSON.stringify()` — fail the build if it throws
- For types that must use Set/Map internally (e.g., for performance), convert to array/object at the reducer boundary before returning from the node

**Detection:** The error fires on first checkpoint write. Run a smoke test that executes one full graph cycle with all state fields populated — this will catch it before users do.

**Phase:** Address in Phase 1 (core infrastructure) when defining state schemas. Never retrofit.

---

### Pitfall 2: MemorySaver in Any Non-Local Environment

**What goes wrong:** `MemorySaver` stores all checkpoint state in process memory. Container restarts, deployments, load balancer failovers, and crashes wipe all in-flight conversations. Users lose context silently — the agent appears to "forget" everything.

**Why it happens:** MemorySaver is the default in LangGraph examples. It works perfectly in notebooks and local demos, creating a false sense that checkpointing is "done."

**Consequences:** Complete conversation state loss on any deployment event. In a multi-instance (horizontal scale) deployment, two requests for the same thread can hit different instances and get different state.

**Prevention:** Use `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) from the beginning. Never use `MemorySaver` outside of unit tests. The connection pattern: PostgresSaver holds a connection for the entire run duration — use a dedicated connection pool for checkpointing, separate from the application query pool.

**Detection:** Deploy to staging, restart the container mid-conversation, and verify the agent resumes correctly.

**Phase:** Phase 1. `PostgresSaver` must be the only checkpointer used in any environment that is not a unit test.

---

### Pitfall 3: LangGraph Checkpoint Table Unbounded Growth

**What goes wrong:** Every node execution creates approximately 100 rows across LangGraph's 3 checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`). Without TTL or pruning, a moderately active deployment creates millions of rows within weeks.

**Why it happens:** LangGraph stores every intermediate state for time-travel debugging and human-in-the-loop resumption. There is no automatic expiry — as of LangGraph JS 1.x, there is no built-in TTL configuration.

**Consequences:** Database storage bloat, degraded query performance on the checkpoint tables, and full table scans during thread lookups.

**Prevention:**
- Schedule a PostgreSQL cron job (or pg_cron extension) to delete checkpoint rows older than N days: `DELETE FROM checkpoints WHERE created_at < NOW() - INTERVAL '30 days'`
- Keep `thread_id` scoped to conversation sessions, not global IDs, so old threads can be pruned by age
- Monitor table sizes with `pg_relation_size()` from day one

**Detection:** Watch `checkpoints` table row count. If it exceeds 1M rows in the first month, pruning is not running.

**Phase:** Phase 1 (schema design) for table structure; Phase 2 (observability) for monitoring; Phase 3 for scheduled pruning implementation.

---

### Pitfall 4: LangGraph Schema Evolution Breaking Existing Threads

**What goes wrong:** Renaming a state field, adding a required field without a default value, or changing a field's type in a LangGraph state definition corrupts or breaks any thread that was checkpointed under the old schema. LangGraph does not validate schema compatibility on load — it silently deserializes the old shape into the new schema, producing `undefined` values where the renamed field used to be.

**Why it happens:** The checkpoint blob is stored as raw JSON. On resume, LangGraph deserializes the JSON into the current TypedDict/annotation shape with no migration layer.

**Consequences:** Production agents silently operate on partial/corrupted state after deployments. Bugs only appear mid-conversation, not at startup.

**Prevention:**
- Add a `schema_version: number` field to every state definition from the start
- Treat state schema changes as database migrations: write an explicit migration function that transforms old checkpoint data before the new code goes live
- Always add new fields with a default value (never required without default)
- Never rename fields — add the new name and deprecate the old with a reducer that reads both

**Detection:** After any state schema change, query the checkpoint table for threads that have the old shape and verify they resume without errors.

**Phase:** Phase 1 (state design). The migration pattern must be established before any real users create threads.

---

### Pitfall 5: PGVector Embedding Dimension Lock-in and Mismatch

**What goes wrong:** The embedding dimension is baked into the column definition (`vector(1536)`). Switching embedding providers (e.g., from OpenAI `text-embedding-3-small` at 1536 dims to a 384-dim local model, or to Gemini at 768 dims) requires dropping and recreating the column and re-embedding all stored data. Silent failures also occur: if the configured provider changes via environment variable but the table still expects the old dimension, writes fail with a hard PostgreSQL error — and in some ORM configurations, this error is swallowed.

**Why it happens:** pgvector enforces dimension count strictly at write time. There is no implicit truncation or padding. Changing providers mid-deployment without a schema migration causes write failures.

**Consequences:** Complete memory system failure after an embedding provider change. Re-embedding large knowledge bases is expensive and time-consuming.

**Prevention:**
- Decide on a single embedding provider and dimension before writing any schema migrations — this is a one-way door
- Use `text-embedding-3-small` (1536 dims) or a 384-dim model (3x faster) — document the chosen dimension in the schema file as a constant
- Add a startup assertion: query the column dimension from `pg_attribute` and compare against `EMBEDDING_DIM` env var — crash loudly if they differ
- Never use the unconstrained `vector` type for the main embeddings column (loses index performance)

**Detection:** Write a startup health check that inserts and retrieves a test embedding and verifies the dimension round-trips correctly.

**Phase:** Phase 1 (schema design). The dimension choice is irreversible without a full data migration.

---

### Pitfall 6: IVFFlat Index Created Before Data is Loaded

**What goes wrong:** Creating an IVFFlat index on an empty (or near-empty) table computes k-means centroids against meaningless data. Queries then search against a broken index and return incorrect results — wrong neighbors, degraded recall — with no error messages.

**Why it happens:** IVFFlat is sometimes included in initial schema migration scripts because it looks like a standard index. Developers don't realize the index must be built after the data is populated.

**Consequences:** Semantic search returns nonsensical results silently. This is one of the hardest production bugs to detect because the queries succeed — they just return wrong data.

**Prevention:**
- Use HNSW as the default index type for new deployments — it does not require data to exist at creation time and has higher recall for typical RAG workloads
- If IVFFlat is used for a large static dataset, add it as a post-data-load script, never a schema migration
- Set reasonable defaults: `m = 16, ef_construction = 200` for HNSW (increase only if recall benchmarks show deficiency)
- Set `probes` at query time: the default `1` gives terrible recall — use `SET ivfflat.probes = 10` minimum

**Detection:** Benchmark recall after index creation using known query/result pairs. If recall is below 90%, the index may have been created on empty data.

**Phase:** Phase 1 (schema design). The index type decision should be made explicitly, not by default.

---

### Pitfall 7: Per-Tenant Connection Pool Explosion

**What goes wrong:** Brain Core uses a 1-database-per-tenant model. A naive implementation creates a new Drizzle/`pg` connection pool for each incoming request, or maintains a pool per tenant with no cap on total pools. At 50 concurrent tenants, this opens 50 × pool_size connections to PostgreSQL, which has a hard limit (typically 100 default, configurable to several hundred).

**Why it happens:** The pattern "get tenant DB name from request → create DB connection → run query" is straightforward and works in development with one tenant. In production with many tenants, the resource math breaks immediately.

**Consequences:** PostgreSQL connection exhaustion (`FATAL: remaining connection slots are reserved for non-replication superuser connections`), cascading query failures across all tenants.

**Prevention:**
- Use a connection cache: maintain a `Map<tenantId, Pool>` keyed by tenant, with a maximum cap (e.g., 20 pools) and LRU eviction for idle tenants
- Size each per-tenant pool small (2-5 connections) rather than using defaults
- Add a global connection count metric — alert if total connections exceed 70% of `max_connections`
- Consider PgBouncer in transaction-pooling mode in front of PostgreSQL for deployments with >20 tenants

**Detection:** Load test with 10+ simulated tenants making simultaneous requests and watch `pg_stat_activity` connection counts.

**Phase:** Phase 1 (multi-tenancy foundation). The connection architecture must be designed before the first request handler is written.

---

### Pitfall 8: Drizzle Client Recreation Per Request (Multi-Tenant)

**What goes wrong:** A common multi-tenant pattern is to call `drizzle(new Pool({ database: tenantDbName }))` inside the request handler. Each call creates a new pool object, which does not get reused, and the previous pool is never cleanly closed. This leaks connections and adds ~10-50ms overhead per request for pool initialization.

**Why it happens:** Drizzle's `drizzle()` constructor accepts a fresh pool instance, making per-request client creation syntactically easy. There's no warning when you do this — it works, it's just expensive.

**Consequences:** Connection leak, memory growth, and latency degradation over time.

**Prevention:**
- Cache Drizzle instances in a `Map<tenantId, DrizzleDB>` at the module level, created once and reused
- Use a lazy initialization pattern: create the pool on first request for that tenant, cache it, reuse on subsequent requests
- Add a `closeAll()` function for graceful shutdown that drains all cached pools

**Detection:** Log pool creation events. If the same tenant triggers pool creation more than once per process lifetime, the cache is not working.

**Phase:** Phase 1 (database layer). Establish the pattern in `packages/database` before any Brain uses it.

---

## Moderate Pitfalls (v1.0 — preserved)

---

### Pitfall 9: LangGraph Recursion Limit Too Low for Complex Agents

**What goes wrong:** LangGraph's default `recursionLimit` is 25 (counting each node visit as one step). A Brain with a qualification sub-agent (the SDR pattern: main agent → qualifies lead → returns to main) can exhaust 25 steps in a single conversation turn with tool calls.

**Prevention:**
- Set `recursionLimit` explicitly in `graph.compile()` config: 50 for simple agents, 100 for agents with subgraphs
- The default 25 was chosen to catch infinite loops, not as a reasonable workflow limit — treat it as a minimum floor, not a production setting
- Implement explicit termination conditions in subgraphs rather than relying on the limit as a circuit breaker

**Phase:** Phase 2 (agent orchestration). Test with realistic multi-turn conversations before declaring an agent "done."

---

### Pitfall 10: LangGraph Parallel Node State Reducer Conflicts

**What goes wrong:** When two nodes execute in parallel and both write to the same state key without a reducer, LangGraph throws `InvalidUpdateError`. This is not caught at graph compile time — it only fires at runtime when the parallel branch actually executes.

**Prevention:**
- Define explicit reducers for every state key that could be written by parallel nodes: `Annotated<T, (a: T, b: T) => T>`
- For lists that accumulate results (e.g., tool outputs), use `(existing, update) => [...existing, ...update]`
- Add a capped reducer for lists to prevent unbounded growth: `(existing, update) => [...existing, ...update].slice(-N)`

**Phase:** Phase 2 (agent graph design). Any graph with a fan-out pattern must define reducers before the first run.

---

### Pitfall 11: Bun `node:async_hooks` Gaps Break APM and Some LangChain Internals

**What goes wrong:** Bun's `node:async_hooks` implementation is missing V8 promise hooks. Libraries that depend on `AsyncLocalStorage` for context propagation (LangChain's callback handlers, some APM agents like `dd-trace`, OpenTelemetry SDK) may fail silently or produce broken traces.

**Prevention:**
- Test LangChain's callback propagation (LangSmith tracing) explicitly with Bun before relying on it in production
- Avoid `dd-trace` with Bun — use OpenTelemetry with the `@opentelemetry/sdk-node` package, which has better Bun compatibility
- If a library requires native modules (`node-gyp`), find a pure-JS alternative (`bcryptjs` instead of `bcrypt`)

**Detection:** Run the LangSmith tracing integration test on Bun. If traces appear incomplete or missing, `async_hooks` is the culprit.

**Phase:** Phase 1 (observability setup). Validate the tracing stack on Bun before integrating it into the core.

---

### Pitfall 12: Bun Monorepo Workspace Install Performance Regression

**What goes wrong:** Bun workspaces can be 70x slower than pnpm for dependency resolution in monorepos where packages are already installed (the "no-op install" case). Reported as a Bun regression in January 2026. This makes CI pipelines and local development unnecessarily slow.

**Prevention:**
- Use `pnpm` as the workspace/package manager for the monorepo, even though `bun` is the runtime
- In Docker builds and CI, use `pnpm install --frozen-lockfile` for package installation
- Use `bun run` (or explicit `bun <script>`) only for script execution and the runtime — not for package management

**Detection:** Time `bun install` on a warm cache vs. `pnpm install`. If Bun is significantly slower, switch package management to pnpm.

**Phase:** Phase 1 (monorepo scaffolding). The package manager decision is hardest to change later.

---

### Pitfall 13: TypeScript Path Aliases Not Resolved at Runtime by Bun

**What goes wrong:** TypeScript `paths` in `tsconfig.json` (e.g., `@brain/core` → `../../packages/core/src`) are a TypeScript compiler feature — they are not understood by Node.js or Bun at runtime. Running `bun src/index.ts` directly will fail with `Module not found: @brain/core` even if tsc compiles successfully.

**Why it happens:** Developers configure paths for IDE autocompletion and tsc type checking. They assume the runtime handles them the same way. It does not — path aliases require either a bundler (esbuild, tsup) or Bun's `bunfig.toml` alias configuration to work at runtime.

**Prevention:**
- For Bun runtime: define aliases in `bunfig.toml` under `[alias]` section to mirror the tsconfig paths
- Alternatively, use Node.js subpath imports (`imports` field in `package.json`) which are natively supported by both tsc and Bun
- Never rely on tsc compilation for runtime alias resolution — use a bundler or runtime-native alias mechanism

**Detection:** After adding a new path alias to tsconfig, run `bun src/index.ts` directly (not through a bundler) and verify it resolves. If not, the alias is only a type-level alias.

**Phase:** Phase 1 (monorepo TypeScript config). Establish the alias resolution pattern before it proliferates across packages.

---

### Pitfall 14: LangGraph/LangChain Peer Dependency Version Drift

**What goes wrong:** `@langchain/core`, `@langchain/langgraph`, and `langchain` share peer dependencies but are versioned independently. Installing `@langchain/langgraph@1.3.x` with an incompatible `@langchain/core@0.x` causes silent type errors, runtime failures in message serialization, and "duck-typed" incompatibilities that are extremely hard to trace.

**Prevention:**
- Pin exact versions for all `@langchain/*` packages in `package.json` — do not use caret (`^`) ranges
- Use pnpm's `peerDependencyRules` to enforce consistent peer resolution
- Create a single source of truth: define all `@langchain/*` versions in the root `package.json` and use `workspace:*` in packages that consume them
- Update all `@langchain/*` packages together in a single commit, never independently

**Detection:** Run `pnpm why @langchain/core` and verify only one version appears in the resolution tree.

**Phase:** Phase 1 (monorepo package setup). Lock versions before writing any LangGraph code.

---

### Pitfall 15: Tool Call Infinite Loop Under Rate Limiting

**What goes wrong:** LLM API rate limits cause tool calls to fail with transient errors. Naive retry logic retries the same tool call indefinitely, which — combined with LangGraph's loop structure — creates a feedback loop that burns through the recursion limit, generates enormous token usage, and may trigger secondary rate limits.

**Prevention:**
- Implement tool-level retry with exponential backoff and a hard cap (max 3 retries per tool call)
- Return a structured error result from the tool instead of throwing — let the LLM decide how to handle it rather than having the infrastructure retry blindly
- Set `maxExecutionTime` on the graph invoke call as a hard wall-clock timeout
- Track tool call counts in state — if any single tool has been called more than 5 times in one graph run, trigger a graceful abort

**Detection:** Inject a failing tool in staging and observe agent behavior — it should fail gracefully within seconds, not spin for minutes.

**Phase:** Phase 2 (tools registry). Tool error handling patterns must be established when the first real tool is implemented.

---

### Pitfall 16: Memory Layer Mixing — Embedding All Messages Into Vector Store

**What goes wrong:** Storing every conversation message in the vector store (PGVector) as an embedding is the most common memory architecture mistake. It creates retrieval noise (small talk, filler phrases, acknowledgements returning as "relevant" context), inflates storage, and makes semantic search progressively less useful as volume grows.

**Prevention:**
- Only embed semantically rich content: user-stated facts, preferences, goals, documents, and knowledge base entries
- Keep conversation history as structured records in PostgreSQL (not PGVector) — retrieve it with time-based queries, not similarity search
- Run a summarization/extraction step that distills conversation turns into facts before embedding them
- Separate tables: `memories` (structured facts) vs. `embeddings` (vector index) vs. `agent_state` (LangGraph checkpoints)

**Detection:** After 100 conversation turns, query PGVector for "hello" — if it returns conversation turns from 3 weeks ago, your embedding strategy needs filtering.

**Phase:** Phase 2 (memory architecture). The 3-layer memory design (short-term, long-term, semantic) must be implemented as distinct components with explicit boundaries.

---

## Minor Pitfalls (v1.0 — preserved)

---

### Pitfall 17: PGVector HNSW Index Memory Usage Surprise

**What goes wrong:** HNSW indexes consume 2-5x more memory than IVFFlat because the graph stores neighbor connections at every layer. At `m = 64, ef_construction = 500` (common "high quality" settings found in blog posts), memory usage can exceed available RAM on modest servers, causing the index to be paged to disk and destroying query performance.

**Prevention:** Start with `m = 16, ef_construction = 200`. These are the conservative defaults that work well up to millions of vectors. Increase only if recall benchmarks show deficiency. Index building happens in memory — ensure the Postgres server has at least `(vectors × dimensions × 4 bytes × 2)` free RAM before building.

**Phase:** Phase 1 (schema) and Phase 3 (performance tuning).

---

### Pitfall 18: LangGraph `interrupt_before` vs `interrupt_after` Confusion

**What goes wrong:** Human-in-the-loop flows use `interrupt_before` or `interrupt_after` to pause execution. Using `interrupt_after` means the node's action has already executed before the pause — the user is reviewing a fait accompli, not approving a pending action. This is the most frequently reported human-in-the-loop mistake.

**Prevention:** For approval flows, always use `interrupt_before`. Reserve `interrupt_after` for "review what happened" use cases, not "approve before proceeding."

**Phase:** Phase 3 (human-in-the-loop features, if applicable).

---

### Pitfall 19: Missing Subgraph Checkpointer Inheritance

**What goes wrong:** In Brain Core's SDR pattern (main Brain → qualification sub-agent), the parent graph's checkpointer is not automatically inherited by compiled subgraphs. If the subgraph is compiled independently (`subgraph.compile()` with no checkpointer), its internal state is not persisted and cannot be inspected or resumed.

**Prevention:** Pass the parent's checkpointer to the subgraph via `subgraph.compile({ checkpointer: parentCheckpointer })`, or use the subgraph as an uncompiled node (adding it directly as a node rather than calling `.compile()` on it separately).

**Phase:** Phase 2 (agent orchestration, when the qualification sub-agent is built).

---

## Sources

### v1.1 Sources
- amqplib unhandled rejection on channel close: [amqplib issue #250 — Channel ended, no reply will be forthcoming](https://github.com/amqp-node/amqplib/issues/250)
- amqplib connection close uncatchable: [amqplib issue #334 — connection.close causes process to die](https://github.com/squaremo/amqp.node/issues/334)
- RabbitMQ auto-reconnect Node.js: [Ecostack — RabbitMQ Auto Reconnect Node.js](https://ecostack.dev/posts/rabbitmq-auto-reconnect-nodejs/)
- RabbitMQ graceful shutdown: [KiritoA Blog — Shutdown RabbitMQ consumer gracefully](https://kiritox.me/shutdown-rabbitmq-consumer-gracefully/)
- RabbitMQ DLX Node.js: [Elest.io — RabbitMQ + Node.js with Dead Letter Queues](https://blog.elest.io/rabbitmq-node-js-build-resilient-event-driven-microservices-with-dead-letter-queues/)
- RabbitMQ best practices (connection/channel): [CloudAMQP — RabbitMQ Best Practices](https://www.cloudamqp.com/blog/part1-rabbitmq-best-practice.html)
- RabbitMQ 13 common errors: [CloudAMQP — 13 Common RabbitMQ Mistakes](https://www.cloudamqp.com/blog/part4-rabbitmq-13-common-errors.html)
- LangGraph thread_id cross-contamination: [langgraphjs issue #2040 — Cross-thread checkpoint data contamination](https://github.com/langchain-ai/langgraphjs/issues/2040)
- LangGraph PostgresSaver race condition fix: [LangGraph PR #2494 — Fix race condition in PostgresSaver](https://github.com/langchain-ai/langgraph/pull/2494)
- LangGraph mixed thread_id formats bug: [LangGraph issue #6623 — Partial Graph State Missing Due to Mixed thread_id Formats](https://github.com/langchain-ai/langgraph/issues/6623)
- LangGraph context window management 2026: [Zylos Research — Context Window Management and Session Lifecycle](https://zylos.ai/research/2026-03-31-context-window-management-session-lifecycle-long-running-agents/)
- LangGraph trim_messages: [LangChain Docs — Short-term memory](https://docs.langchain.com/oss/python/langchain/short-term-memory)
- Context window overflow Redis 2026: [Redis Blog — Context Window Overflow in 2026](https://redis.io/blog/context-window-overflow/)
- Drizzle migration concurrent instances: [DEV — Drizzle ORM Migrations in Production: Zero-Downtime Schema Changes](https://dev.to/whoffagents/drizzle-orm-migrations-in-production-zero-downtime-schema-changes-e71)
- Drizzle column rename/drop safety: [DEV — Zero-Downtime Postgres Migrations with Drizzle ORM](https://dev.to/whoffagents/zero-downtime-postgres-migrations-with-drizzle-orm-22ga)
- PostgreSQL advisory locks: [Leapcell — Orchestrating Distributed Tasks with PostgreSQL Advisory Locks](https://leapcell.io/blog/orchestrating-distributed-tasks-with-postgresql-advisory-locks)
- Advisory lock PgBouncer incompatibility: [IBM mcp-context-forge issue #4051](https://github.com/IBM/mcp-context-forge/issues/4051)
- NanoID vs UUID collision risk: [Toolsbase — UUID v4 vs v7 vs NanoID vs CUID2](https://toolsbase.dev/en/blog/uuid-comparison-guide)
- Docker image size reduction Bun/Node: [Better Stack — Reducing Docker Image Sizes](https://betterstack.com/community/guides/scaling-docker/reducing-docker-image-size/)

### v1.0 Sources
- LangGraph serialization: [Fix LangGraph JSON Serialization Error](https://markaicode.com/errors/langgraph-json-parse-error-fix/)
- LangGraph state management undocumented issues: [LangGraph State Management Guide](https://altersquare.io/langgraph-state-management-undocumented-issues-after-commit/)
- LangGraph checkpointing best practices: [Mastering LangGraph Checkpointing 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025/)
- LangGraph checkpoint growth: [How to keep checkpoint data from growing unbounded](https://github.com/langchain-ai/langgraphjs/issues/1138)
- LangGraph PostgresSaver: [@langchain/langgraph-checkpoint-postgres npm](https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres)
- LangGraph recursion limit: [GRAPH_RECURSION_LIMIT docs](https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT)
- LangGraph infinite loop bug: [Agent infinite looping issue #6731](https://github.com/langchain-ai/langgraph/issues/6731)
- LangGraph subgraph state: [Subgraph state communication forum](https://forum.langchain.com/t/how-does-state-work-in-langgraph-subgraphs/1755)
- Multi-agent pitfalls: [Architecting Multi-Agent Systems with LangGraph](https://medium.com/@timarkanta.sharma/architecting-multi-agent-systems-with-langgraph-patterns-trade-offs-and-real-world-design-ba8c535c6b35)
- LangChain versioning: [LangChain and LangGraph 1.0 milestone](https://blog.langchain.com/langchain-langgraph-1dot0/)
- LangGraph prebuilt breaking change: [Issue #6363 version constraints](https://github.com/langchain-ai/langgraph/issues/6363)
- PGVector HNSW vs IVFFlat: [IVFFlat vs HNSW in pgvector](https://dev.to/philip_mcclarence_2ef9475/ivfflat-vs-hnsw-in-pgvector-which-index-should-you-use-305p)
- PGVector performance: [pgvector performance benchmark](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/)
- PGVector dimension mismatch: [pgvector Dimension Mismatch 2026](https://dbadataverse.com/tech/postgresql/2026/05/pgvector-gotchas-dimension-mismatch-casting-errors-and-alter-table-solved-2026)
- AI agent memory architecture: [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Tool call reliability: [LLM Tool-Calling in Production](https://medium.com/@komalbaparmar007/llm-tool-calling-in-production-rate-limits-retries-and-the-infinite-loop-failure-mode-you-must-2a1e2a1e84c8)
- Multi-tenant connection pooling: [How to Implement Multi-Tenancy in Node.js](https://oneuptime.com/blog/post/2026-01-27-nodejs-multi-tenancy/view)
- Bun Node.js compatibility: [Bun Node.js Compatibility Docs](https://bun.com/docs/runtime/nodejs-compat)
- Bun monorepo issues: [Bun workspace performance issue #25799](https://github.com/oven-sh/bun/issues/25799)
- Bun production evaluation: [Bun in 2025: Critical Evaluation](https://angelo-lima.fr/en/bun-2025-critical-evaluation-javascript-runtime-alternative/)
- TypeScript monorepo path aliases: [TypeScript Path Aliases in Turborepo](https://www.xjavascript.com/blog/how-to-configure-module-aliases-in-a-monorepo-bootstrapped-with-turborepo/)
- Drizzle multi-tenant: [Drizzle ORM multi-tenancy discussion](https://github.com/mateusflorez/drizzle-multitenant)
