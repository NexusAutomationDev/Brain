# Phase 2: Domain Packages - Research

**Researched:** 2026-06-11
**Domain:** LangGraph checkpointing, memory layers, LLM/embedding factories, Hono webhook transport, Langfuse observability
**Confidence:** HIGH

## Summary

Phase 2 creates three domain packages (`packages/memory`, `packages/ai`, `packages/transport`) plus Langfuse integration in `packages/observability`. All packages consume assets from Phase 1 — `TenantPoolManager`, `createLogger`, `BrainError/ConfigurationError`, and the Drizzle schema — and must be individually testable before `packages/core` assembles them in Phase 3.

The central technical challenge is the `PostgresSaver` driver mismatch: `@langchain/langgraph-checkpoint-postgres` depends on `pg` (node-postgres, `^8.12.0`) as its internal connection driver, while the rest of the project uses `postgres.js`. Both coexist without conflict since each package manages its own connection — `PostgresSaver` opens its own `pg.Pool` against the same database, and Drizzle opens a `postgres.js` connection. This is the correct architecture: do not attempt to share drivers between them.

The second key finding is that `@langchain/core` is now at v1.1.48 (1.x GA). The LangGraph packages (`1.4.1`) and all provider adapters already require `@langchain/core ^1.1.x`. The v1 migration breaking changes apply only to the high-level `langchain` meta-package (`createAgent`, `createReactAgent` etc.) — **not** to `@langchain/langgraph` StateGraph, Annotation, or checkpointer APIs, which are stable.

**Primary recommendation:** Install `@langchain/langgraph@^1.4.1`, `@langchain/langgraph-checkpoint-postgres@^1.0.3`, and `@langfuse/langchain@^5.4.1`. Use `PostgresSaver.fromConnString()` with `TEST_DATABASE_URL` for integration tests; use `FakeEmbeddings` from `@langchain/core/utils/testing` for embedding pipeline tests. Implement the dedup cache as a plain `Map<string, number>` with TTL eviction on insertion (not on read), defaulting to 10 minutes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Observability (OBS-03)
- **D-01:** Use **Langfuse** (not LangSmith) — matches REQUIREMENTS.md OBS-03 and SC-4. LangSmith blocked by AsyncLocalStorage on Bun.
- **D-02:** Integration via **LangChain `CallbackHandler`** — `new CallbackHandler()` passed as callback in graph invocations. No manual node instrumentation. Activated by env vars `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`. Silent if absent (no startup failure).

#### Transport / Webhook (TRANS-01 to TRANS-04)
- **D-03:** Webhook idempotency via **in-memory TTL cache** — `Map<requestId, timestamp>` with TTL 5–10 min. Zero extra infra, O(1) lookup. State lost on restart (acceptable for v1).
- **D-04:** Webhook endpoint path: **`/api/v1/webhook`** (versioned, not configurable via env for now).
- **D-05:** `ITransport` as abstract interface — Webhook implementation separate from contract. RabbitMQ deferred to v2.

#### LLM Provider (AI-05)
- **D-06:** Provider configured **100% via env** — no hardcoded default:
  - `LLM_PROVIDER=openai|anthropic|gemini|openrouter`
  - `LLM_MODEL=` (e.g., `gpt-4o`, `claude-sonnet-4-6`, `gemini-2.0-flash`)
  - `EMBEDDING_MODEL=` — keep existing name from Phase 1 schema
  - `EMBEDDING_DIMENSIONS=` — already exists
- **D-07:** Factory `createLLM(options)` returns `BaseChatModel`. Without `LLM_PROVIDER` → startup fails with `ConfigurationError`.
- **D-08:** Initial support for 4 providers: OpenAI, Anthropic, Gemini, OpenRouter (all via LangChain adapters).

#### Tests
- **D-09:** Unit tests use **full mock via `bun test` `mock.module()`** — LLM and embedding provider mocked, deterministic, zero cost/latency.
- **D-10:** `PostgresSaver` integration tests (SC-1) run against **real PostgreSQL** via `TEST_DATABASE_URL`. AI-01 forbids `MemorySaver` outside unit tests.
- **D-11:** Embedding tests with real PG use **FakeEmbeddings** (deterministic hash-based vectors) — tests DB pipeline, HNSW index, cosine search without external API calls.

#### Carried from Phase 1
- **D-01 (P1):** Packages organized by domain — new packages follow same pattern.
- **D-03 (P1):** Path aliases `@brain-pkg/*` — new packages follow same namespace.
- **D-06/D-08 (P1):** Forward-only migrations, container fails startup if migration fails.

### Claude's Discretion
- Exact TTL for in-memory dedup cache (suggestion: 10 minutes).
- Internal structure of `MemoryManager` (composition vs. inheritance for 3 layers).
- How to expose the Langfuse `CallbackHandler` to consumers (singleton vs. factory per request).

### Deferred Ideas (OUT OF SCOPE)
- RabbitMQ transport implementation → v2 (ITransport interface already planned, just plug in)
- OpenTelemetry as self-hosted alternative to Langfuse → v2
- Checkpoint table pruning job → v2
- Redis for idempotency → not in v1 stack
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | Short-term memory via LangGraph `PostgresSaver` (session checkpoints) | PostgresSaver API + `pg` driver compatibility confirmed; setup() + thread_id pattern documented |
| MEM-02 | Long-term memory — structured user profile read/write via Drizzle (memories table) | `memories` table schema exists in Phase 1; `drizzle-orm` cosine query pattern documented |
| MEM-03 | Semantic memory — async fire-and-forget embedding upsert after each turn | pgvector HNSW index + cosineDistance pattern documented; FakeEmbeddings for testing |
| MEM-04 | `MemoryManager` abstraction encapsulating 3 layers with unified interface | Composition pattern recommended; all 3 layer APIs verified |
| AI-01 | LangGraph + `PostgresSaver` as sole checkpointer (MemorySaver forbidden outside unit tests) | PostgresSaver.fromConnString() verified; pg driver (not postgres.js) used internally |
| AI-02 | Sub-agent support via subgraph pattern (parent Brain invokes child graph, receives result) | LangGraph subgraph pattern confirmed; compiled graphs usable as nodes |
| AI-03 | State schema with `schema_version` field; JSON-safe primitives only (no Set, Map, Date, Buffer) | Annotation.Root API documented; JSON-safe constraint enforced by type design |
| AI-04 | Embedding provider and dimension configurable via env (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) | Phase 1 schema already reads env vars; factory pattern verified |
| AI-05 | LLM provider abstraction (OpenAI, Gemini, Anthropic, OpenRouter) | @langchain/openai 1.4.7, @langchain/anthropic 1.4.0, @langchain/google-genai 2.1.31 verified |
| TRANS-01 | Abstract `ITransport` interface decoupled from implementation | TypeScript interface pattern; documented |
| TRANS-02 | Webhook implementation with Hono — receives messages via HTTP POST | Hono 4.12.25 in project already; route pattern from Phase 1 |
| TRANS-03 | Webhook idempotency via deterministic key (X-Request-Id header) | In-memory Map TTL pattern documented; 200/409 response pattern confirmed |
| TRANS-04 | Transport selection via `TRANSPORT` env (`webhook` in v1) | Simple env check at package init; `ConfigurationError` if unknown value |
| OBS-03 | Langfuse integration via LangChain callbacks — activated by env vars | @langfuse/langchain 5.4.1 verified; CallbackHandler API documented; graceful fallback pattern verified |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@langchain/langgraph` | 1.4.1 | Agent graph orchestration + StateGraph | Project constraint; explicit state machines, checkpoint support, subgraph pattern |
| `@langchain/core` | 1.1.48 | LLM abstractions, message types, Embeddings interface | Peer dep of langgraph; all provider adapters require this version |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.3 | PostgreSQL-backed checkpoint storage | Durable agent state across restarts; uses PostgreSQL already in stack |
| `@langfuse/langchain` | 5.4.1 | LangGraph/LangChain callback-based tracing | Decision D-01/D-02; peer-compatible with @langchain/core >=0.3.8 |
| `@langchain/openai` | 1.4.7 | OpenAI chat model adapter | Primary LLM provider; peer dep: @langchain/core ^1.1.48 |
| `@langchain/anthropic` | 1.4.0 | Anthropic chat model adapter | Provider D-08; peer dep: @langchain/core ^1.1.47 |
| `@langchain/google-genai` | 2.1.31 | Google Gemini chat model adapter | Provider D-08; peer dep: @langchain/core ^1.1.47 |

**Version verification:** [VERIFIED: npm registry, 2026-06-11]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg` | ^8.12.0 | PostgreSQL client (node-postgres) | Required internally by `@langchain/langgraph-checkpoint-postgres`; pulled in as transitive dep — do NOT use in app code |
| `hono-idempotency` | 0.9.0 | Idempotency middleware for Hono | Optional: provides Idempotency-Key header handling; project uses custom X-Request-Id, so manual implementation is simpler |
| `@opentelemetry/api` | ^1.9.0 | OTEL API (peer dep of @langfuse/langchain) | Required as peer dep; install as dev dep in packages/observability |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@langfuse/langchain` CallbackHandler | LangSmith `LangChainTracer` | LangSmith blocked by Bun `node:async_hooks` gaps; Langfuse confirmed compatible |
| Manual dedup `Map` | `hono-idempotency` package | `hono-idempotency` uses `Idempotency-Key` header; project uses `X-Request-Id` — manual Map is 10 lines and matches spec exactly |
| `PostgresSaver.fromConnString()` | postgres.js adapter | `PostgresSaver` only accepts `pg.Pool` or connection string — it uses `pg` internally. Do not mix drivers. |
| `FakeEmbeddings` from `@langchain/core/utils/testing` | Custom hash embeddings | `FakeEmbeddings` is built-in; generates fixed-dimension vectors; sufficient for pipeline testing |

**Installation (packages/ai):**
```bash
pnpm add @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint-postgres @langchain/openai @langchain/anthropic @langchain/google-genai --filter @brain-pkg/ai
```

**Installation (packages/observability, adding Langfuse):**
```bash
pnpm add @langfuse/langchain @opentelemetry/api --filter @brain-pkg/observability
```

**Installation (packages/memory — no new deps beyond @brain-pkg/database):**
```bash
# packages/memory consumes @brain-pkg/database and @brain-pkg/ai via workspace refs
# No new external deps required
```

**Installation (packages/transport):**
```bash
# packages/transport uses hono (already in @brain-pkg/observability) via workspace
# hono is re-declared as dep in packages/transport
pnpm add hono --filter @brain-pkg/transport
```

## Architecture Patterns

### Recommended Project Structure

```
packages/
├── ai/
│   ├── src/
│   │   ├── graph/
│   │   │   ├── state.ts          # Annotation.Root with schema_version
│   │   │   └── checkpointer.ts   # PostgresSaver factory
│   │   ├── llm/
│   │   │   └── factory.ts        # createLLM(options) → BaseChatModel
│   │   ├── embeddings/
│   │   │   └── factory.ts        # createEmbeddings() → Embeddings
│   │   └── index.ts              # barrel
│   ├── package.json
│   └── tsconfig.json
├── memory/
│   ├── src/
│   │   ├── long-term.ts          # readProfile / writeProfile via Drizzle
│   │   ├── short-term.ts         # getCheckpoint / listCheckpoints via PostgresSaver
│   │   ├── semantic.ts           # upsertEmbedding / searchSimilar via cosineDistance
│   │   ├── manager.ts            # MemoryManager composing 3 layers
│   │   └── index.ts              # barrel
│   ├── package.json
│   └── tsconfig.json
├── transport/
│   ├── src/
│   │   ├── interface.ts          # ITransport abstract contract
│   │   ├── webhook/
│   │   │   ├── handler.ts        # Hono app with /api/v1/webhook route
│   │   │   ├── dedup.ts          # Map<string, number> TTL cache
│   │   │   └── events.ts         # BrainEvent type definition
│   │   ├── factory.ts            # createTransport(env) → ITransport
│   │   └── index.ts              # barrel
│   ├── package.json
│   └── tsconfig.json
```

### Pattern 1: LangGraph State Schema (AI-03)

**What:** Define graph state using `Annotation.Root` with JSON-safe primitives and a `schema_version` field for forward compatibility.

**When to use:** Every StateGraph in `packages/ai` and Brain implementations.

```typescript
// Source: LangGraph.js docs (Annotation API) — VERIFIED: WebSearch 2026-06-11
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export const BrainStateAnnotation = Annotation.Root({
  // schema_version: increment when shape changes (AI-03)
  schema_version: Annotation<number>({ default: () => 1, reducer: (_, next) => next }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  // Only JSON-safe primitives: string, number, boolean, null, plain object, array
  userId: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
  sessionId: Annotation<string>({ default: () => "", reducer: (_, next) => next }),
});

export type BrainState = typeof BrainStateAnnotation.State;
```

**Constraint:** No `Set`, `Map`, `Date`, or `Buffer` in state — PostgresSaver serializes state as JSON; these types round-trip incorrectly.

### Pattern 2: PostgresSaver Setup (AI-01, MEM-01)

**What:** Initialize PostgresSaver with a connection string; call `setup()` once at startup to create checkpoint tables.

**When to use:** `packages/ai` package initialization; NOT per-request.

```typescript
// Source: @langchain/langgraph-checkpoint-postgres docs — VERIFIED: npm registry + WebFetch
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// PostgresSaver uses pg (node-postgres) internally — NOT postgres.js
// This is separate from Drizzle's postgres.js connection — they coexist
export async function createCheckpointer(connectionString: string): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString);
  await checkpointer.setup(); // Creates checkpoints schema if not exists
  return checkpointer;
}

// Usage in StateGraph:
// const graph = builder.compile({ checkpointer });
// const result = await graph.invoke(
//   { messages: [...] },
//   { configurable: { thread_id: sessionId } }  // thread_id = session isolation
// );
```

**Critical note:** `PostgresSaver` creates its own `pg.Pool` and schema tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`). These are separate from the Drizzle-managed tables. Both live in the same PostgreSQL database.

### Pattern 3: createLLM Factory (AI-05, D-06, D-07)

**What:** A single factory function reads `LLM_PROVIDER` and `LLM_MODEL` from env, returns a `BaseChatModel`.

**When to use:** Any code that needs an LLM instance — always via this factory, never direct construction.

```typescript
// Source: @langchain/openai, @langchain/anthropic, @langchain/google-genai docs — VERIFIED: npm registry
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ConfigurationError } from "@brain-pkg/shared";

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

export function createLLM(options: LLMOptions = {}): BaseChatModel {
  const provider = process.env.LLM_PROVIDER;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.API_KEY;

  if (!provider) {
    throw new ConfigurationError("LLM_PROVIDER env var is required", { provider });
  }

  switch (provider) {
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model, openAIApiKey: apiKey, ...options });
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model, anthropicApiKey: apiKey, ...options });
    }
    case "gemini": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ model, apiKey, ...options });
    }
    case "openrouter": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({
        model,
        openAIApiKey: apiKey,
        configuration: { baseURL: "https://openrouter.ai/api/v1" },
        ...options,
      });
    }
    default:
      throw new ConfigurationError(`Unknown LLM_PROVIDER: ${provider}`, { provider });
  }
}
```

**Note:** OpenRouter uses `ChatOpenAI` with a custom `baseURL` — it's OpenAI-compatible. [VERIFIED: WebSearch 2026-06-11]

### Pattern 4: Langfuse CallbackHandler (OBS-03, D-01, D-02)

**What:** Conditional Langfuse tracing enabled only when both env vars are present.

**When to use:** Every LangGraph graph invocation in `packages/ai` and Brain implementations.

```typescript
// Source: langfuse.com/docs/integrations/langchain — VERIFIED: WebFetch 2026-06-11
import { CallbackHandler } from "@langfuse/langchain";

export function createTracingCallbacks(context?: {
  sessionId?: string;
  userId?: string;
}): CallbackHandler[] {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return []; // Silent no-op — no startup failure
  }
  return [new CallbackHandler(context)];
}

// Usage in graph invocation:
// const callbacks = createTracingCallbacks({ sessionId, userId });
// await graph.invoke(input, { configurable: { thread_id: sessionId }, callbacks });
```

**Note:** `@langfuse/langchain@5.4.1` requires `@opentelemetry/api ^1.9.0` as a peer dep. Install it alongside. It does NOT require `LANGFUSE_HOST` if using Langfuse Cloud (default `https://cloud.langfuse.com`). [VERIFIED: npm registry 2026-06-11]

### Pattern 5: Webhook Dedup Cache (TRANS-03, D-03)

**What:** In-memory `Map<requestId, timestamp>` with TTL eviction on write, returning 409 on duplicate.

**When to use:** All POST requests to `/api/v1/webhook`.

```typescript
// Source: project design decision D-03 — [ASSUMED] implementation pattern, not from external docs
const TTL_MS = 10 * 60 * 1000; // 10 minutes (Claude's discretion from D-03)

export class DedupCache {
  private cache = new Map<string, number>();

  /**
   * Returns true if requestId is seen for the first time (should process).
   * Returns false if it's a duplicate (should 409).
   */
  claim(requestId: string): boolean {
    const now = Date.now();
    // Evict expired entries on every write to avoid unbounded growth
    for (const [id, ts] of this.cache) {
      if (now - ts > TTL_MS) this.cache.delete(id);
    }
    if (this.cache.has(requestId)) return false;
    this.cache.set(requestId, now);
    return true;
  }
}
```

**Note:** Evict-on-write (not a setInterval) keeps the implementation single-threaded and avoids timer management. For very high throughput, a setInterval cleanup is preferable, but for v1 this is sufficient.

### Pattern 6: cosine Similarity Search (MEM-03)

**What:** Drizzle-based cosine similarity search using the pgvector `cosineDistance` operator.

**When to use:** `MemoryManager.searchSimilar(userId, queryVector, topK)`.

```typescript
// Source: orm.drizzle.team/docs/guides/vector-similarity-search — VERIFIED: WebFetch 2026-06-11
import { cosineDistance, desc, gt, sql } from "drizzle-orm";
import { embeddings } from "@brain-pkg/database";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export async function searchSimilarEmbeddings(
  db: PostgresJsDatabase,
  userId: string,
  queryVector: number[],
  topK = 3,
  threshold = 0.5
) {
  const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, queryVector)})`;

  return db
    .select({ id: embeddings.id, content: embeddings.content, similarity })
    .from(embeddings)
    .where(gt(similarity, threshold))
    .orderBy(desc(similarity))
    .limit(topK);
}
```

### Anti-Patterns to Avoid

- **Sharing postgres.js Sql instance with PostgresSaver:** PostgresSaver uses `pg.Pool` exclusively. Passing `Sql` from postgres.js will not work and is not type-compatible.
- **Using MemorySaver in non-unit-test code:** AI-01 explicitly forbids this. `MemorySaver` only in `*.test.ts` files when testing without PostgreSQL.
- **Hardcoded LLM model strings:** All model names via `LLM_MODEL` env. Same for `EMBEDDING_MODEL`.
- **`new CallbackHandler()` without checking env vars first:** Creates a Langfuse instance that will error at trace-flush time if keys are invalid. Always check env vars before instantiating.
- **`schema_version` field with message-accumulation reducer:** `schema_version` must use a last-write-wins reducer (`(_, next) => next`), not `messagesStateReducer`. Mixing these corrupts state during resume.
- **Storing `Date` objects in LangGraph state:** Serialize as ISO string. `Date` objects survive in-memory but fail JSON round-trip through PostgresSaver.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LangGraph checkpoint persistence | Custom checkpoint table with Drizzle | `@langchain/langgraph-checkpoint-postgres` | Handles serialization, concurrent writes, thread isolation, blob storage — dozens of edge cases |
| Agent tracing/observability | Manual log-based tracing in nodes | `@langfuse/langchain` CallbackHandler | Auto-captures node inputs/outputs, LLM tokens, tool calls, latencies with zero node instrumentation |
| LLM provider switching | Environment-based `if/else` in every node | `createLLM()` factory + `BaseChatModel` interface | Provider-agnostic code; type-safe; all nodes work with any configured provider |
| Vector similarity search | Raw SQL `<=>` operator strings | `cosineDistance()` from `drizzle-orm` | Type-safe, composable, HNSW index path guaranteed |
| Idempotency middleware | Full RFC-compliant idempotency system | Custom `DedupCache` (10-line Map) | For v1, X-Request-Id TTL is sufficient and matches SC-3 exactly. Full RFC not needed. |

**Key insight:** The LangGraph ecosystem provides most of what's needed out-of-the-box. The domain packages are thin wrappers and factories over established primitives — not reimplementations.

## Common Pitfalls

### Pitfall 1: PostgresSaver Uses `pg`, Not `postgres.js`

**What goes wrong:** Developer tries to pass a `postgres.js` `Sql` instance to `PostgresSaver` or tries to reuse the Drizzle pool for checkpoints. TypeScript compile error or runtime failure.

**Why it happens:** The project uses `postgres.js` for Drizzle (correct, per Phase 1 decision to avoid `bun:sql` bug). `@langchain/langgraph-checkpoint-postgres@1.0.3` declares `pg: ^8.12.0` as its only dependency — it only accepts `pg.Pool`.

**How to avoid:** `PostgresSaver.fromConnString(connectionString)` is the simplest path — it creates its own `pg.Pool` internally. Use `TEST_DATABASE_URL` for integration tests.

**Warning signs:** TypeScript error "Argument of type 'Sql' is not assignable to parameter of type 'Pool'" or runtime "Cannot read property 'query' of undefined".

### Pitfall 2: `setup()` Not Called Before First Graph Invocation

**What goes wrong:** `PostgresSaver.fromConnString()` does NOT automatically create the checkpoint tables. First graph invocation fails with "relation 'checkpoints' does not exist".

**Why it happens:** `setup()` is an async method that must be awaited explicitly, typically at application startup.

**How to avoid:** In `createCheckpointer()`, always `await checkpointer.setup()` before returning. In integration tests, call setup at the start of the test suite (in `beforeAll`).

**Warning signs:** `error: relation "checkpoints" does not exist` in PostgreSQL logs.

### Pitfall 3: `BrainState` JSON Serialization Breaks on Non-Primitive Types

**What goes wrong:** Storing `Date`, `Set`, `Map`, or `Buffer` in LangGraph state. First invocation works (in-memory). On resume from PostgresSaver, state is wrong: `Date` becomes string, `Set` becomes empty object.

**Why it happens:** PostgresSaver serializes checkpoints as JSON. JavaScript's JSON.stringify converts `Date` to ISO string, `Set`/`Map`/`Buffer` to `{}`.

**How to avoid:** Enforce JSON-safe-only types in `Annotation.Root`. Use ISO strings for timestamps (`string`), plain arrays for sets, plain objects for maps.

**Warning signs:** After a "container restart" simulation test, `instanceof Date` fails on resumed state, or Set contains no items.

### Pitfall 4: Langfuse CallbackHandler Not Flushed in Tests

**What goes wrong:** Integration test exits before Langfuse sends buffered traces. No traces appear in dashboard even though code ran correctly.

**Why it happens:** Langfuse batches traces asynchronously. In a long-running server, flush happens naturally. In a test process that exits after `await graph.invoke()`, buffered events are dropped.

**How to avoid:** In integration tests that verify Langfuse traces (SC-4), call `await handler.flushAsync()` at the end of the test. In production server code, this is not needed.

**Warning signs:** Dashboard empty after running integration test, but no errors thrown.

### Pitfall 5: `@langchain/core` v1 Migration Impact (Scoped)

**What goes wrong:** Developer reads the LangChain v1 migration guide and thinks `StateGraph`, `Annotation`, checkpointers, or `BaseChatModel` have breaking changes.

**Why it happens:** The `@langchain/core` v1 migration guide describes changes to the `langchain` meta-package (`createAgent`, `createReactAgent`, `ChatPromptTemplate` etc.). The `@langchain/langgraph` StateGraph API and `@langchain/core` model interfaces are **not affected**.

**How to avoid:** We do NOT use the `langchain` meta-package. Our stack is `@langchain/langgraph` + `@langchain/core` + provider adapters. These APIs are stable in v1.

**Warning signs:** If you see advice to use `createAgent` from `langchain` — that's the meta-package, not our stack.

### Pitfall 6: `cosineDistance` Requires `pgvector` Extension

**What goes wrong:** Similarity search query fails with "operator does not exist: vector <=> vector" on first run in a new database.

**Why it happens:** The `CREATE EXTENSION vector` must be run before any vector operations. Phase 1 migration handles this for the main database, but `brain_test` needs the same setup.

**How to avoid:** The `createCheckpointer()` / test `beforeAll` setup should also ensure `CREATE EXTENSION IF NOT EXISTS vector`. Alternatively, ensure `TEST_DATABASE_URL` points to a database where the migration has been run.

**Warning signs:** "operator does not exist: vector <=> vector" or "type 'vector' does not exist".

## Code Examples

### StateGraph with PostgresSaver — Integration Test Pattern

```typescript
// Source: LangGraph.js persistence docs + project pattern — [CITED: docs.langchain.com/oss/javascript/langgraph/persistence]
import { describe, it, expect, beforeAll } from "bun:test";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "@brain-pkg/ai";

describe("PostgresSaver persistence (SC-1)", () => {
  let checkpointer: PostgresSaver;

  beforeAll(async () => {
    const connStr = process.env.TEST_DATABASE_URL!;
    checkpointer = PostgresSaver.fromConnString(connStr);
    await checkpointer.setup(); // Creates checkpoint tables if not exists
  });

  it("persists state across simulated restarts", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("increment", (state) => ({ schema_version: state.schema_version + 1 }))
      .addEdge("__start__", "increment")
      .addEdge("increment", "__end__")
      .compile({ checkpointer });

    const config = { configurable: { thread_id: "test-restart-001" } };

    // Invocation 1 (simulates first container run)
    const result1 = await graph.invoke({ schema_version: 1 }, config);
    expect(result1.schema_version).toBe(2);

    // Invocation 2 (same thread_id — simulates container restart resuming state)
    const result2 = await graph.invoke({}, config);
    expect(result2.schema_version).toBe(3); // accumulated from persisted checkpoint
  });
});
```

### FakeEmbeddings Pipeline Test (SC-2 / D-11)

```typescript
// Source: @langchain/core/utils/testing — VERIFIED: WebSearch 2026-06-11
import { FakeEmbeddings } from "@langchain/core/utils/testing";
import { MemoryManager } from "@brain-pkg/memory";

// FakeEmbeddings produces fixed-dimension float[] vectors
// Deterministic: same input → same output (suitable for HNSW cosine search)
const embeddings = new FakeEmbeddings();
const queryVector = await embeddings.embedQuery("test query");
// queryVector is number[] of length = default dimension (typically 10 for FakeEmbeddings)

// Note: FakeEmbeddings dimension is small (10). In tests against real PG,
// ensure the test database schema uses EMBEDDING_DIMENSIONS=10 or
// use a custom FakeEmbeddings implementation matching EMBEDDING_DIMENSIONS.
```

**Critical:** `FakeEmbeddings` defaults to 10 dimensions. The schema column is sized by `EMBEDDING_DIMENSIONS` env (default 1536). For integration tests that insert into PG, set `EMBEDDING_DIMENSIONS=10` in test env or build a `HashFakeEmbeddings` that matches the configured dimension.

### Webhook Handler with Dedup (TRANS-02, TRANS-03)

```typescript
// Source: Hono docs (hono.dev) + project pattern — [CITED: hono.dev/docs]
import { Hono } from "hono";
import { DedupCache } from "./dedup.js";
import type { BrainEvent } from "./events.js";

const cache = new DedupCache(); // singleton per process

export function createWebhookApp(): Hono {
  const app = new Hono();

  app.post("/api/v1/webhook", async (c) => {
    const requestId = c.req.header("X-Request-Id");

    if (!requestId) {
      return c.json({ error: "X-Request-Id header required" }, 400);
    }

    if (!cache.claim(requestId)) {
      return c.json({ error: "Duplicate request" }, 409);
    }

    const event = await c.req.json<BrainEvent>();
    // ... dispatch event
    return c.json({ status: "accepted" }, 200);
  });

  return app;
}
```

### LLM Mock in Bun Unit Tests (D-09)

```typescript
// Source: bun.sh/docs/test/mocks — VERIFIED: WebSearch 2026-06-11
import { describe, it, expect, mock } from "bun:test";

// mock.module intercepts the entire module — zero real API calls
mock.module("@langchain/openai", () => ({
  ChatOpenAI: class {
    async invoke(messages: unknown[]) {
      return { content: "mocked response", tool_calls: [] };
    }
  },
}));

// Now import after mock setup
const { createLLM } = await import("@brain-pkg/ai");

describe("createLLM factory (AI-05)", () => {
  it("creates OpenAI model from env", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o";
    process.env.API_KEY = "test-key";

    const llm = createLLM();
    expect(llm).toBeDefined();
  });

  it("throws ConfigurationError without LLM_PROVIDER", () => {
    delete process.env.LLM_PROVIDER;
    expect(() => createLLM()).toThrow("LLM_PROVIDER");
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@langchain/core` 0.3.x | `@langchain/core` 1.1.x | 2025-2026 | New `contentBlocks` on messages; `config.configurable` still works for backward compat |
| `LangSmith` tracing on Bun | `Langfuse` via `@langfuse/langchain` | Project decision (2026) | Avoids `node:async_hooks` gaps; Langfuse 5.4.1 confirmed compatible |
| `MemorySaver` for all tests | `PostgresSaver` for integration, `MemorySaver` unit-only | LangGraph 1.x best practice | Durable state, accurate persistence testing |
| `cosineDistance` raw SQL | `cosineDistance()` from `drizzle-orm` | Drizzle 0.36+ | Type-safe, HNSW index hint automatic |
| `langchain` meta-package agents | `@langchain/langgraph` StateGraph directly | LangChain v1 (2025) | We never used the meta-package; no impact |

**Deprecated/outdated:**
- `MemorySaver` in production: Replaced by `PostgresSaver` — state lost on restart
- `langchain-langfuse` (old package name): Replaced by `@langfuse/langchain` — new package name, v5
- `LANGFUSE_HOST` pointing to old domains: Current SDK defaults to `https://cloud.langfuse.com`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pg` (node-postgres) works correctly with Bun 1.3.2 | Standard Stack, Pitfall 1 | PostgresSaver would fail to connect; workaround: use `PostgresSaver.fromConnString` which wraps pg.Pool |
| A2 | `FakeEmbeddings` from `@langchain/core/utils/testing` produces fixed-dimension vectors suitable for pgvector HNSW testing | Code Examples (SC-2) | May need custom `HashFakeEmbeddings` matching `EMBEDDING_DIMENSIONS=1536` |
| A3 | OpenRouter works via `ChatOpenAI` with custom `baseURL` (OpenAI-compatible API) | Pattern 3 (createLLM factory) | OpenRouter may require additional headers (e.g., `HTTP-Referer`) for production use |
| A4 | LangGraph StateGraph API (`Annotation.Root`, `messagesStateReducer`) is unchanged in 1.4.1 vs 1.3.7 | Standard Stack | If API changed, migration guide will be in LangGraph changelog |

## Open Questions

1. **FakeEmbeddings dimension mismatch with production schema**
   - What we know: `FakeEmbeddings` defaults to 10 dimensions; schema uses `EMBEDDING_DIMENSIONS` (default 1536)
   - What's unclear: Does `FakeEmbeddings` accept a configurable dimensions parameter?
   - Recommendation: Check `FakeEmbeddings` constructor in `@langchain/core/utils/testing`. If not configurable, build a `HashFakeEmbeddings` that returns `Array(Number(process.env.EMBEDDING_DIMENSIONS)).fill(0).map((_, i) => hash(content + i) % 1 / 1)` — deterministic, correct dimension.

2. **PostgresSaver schema isolation: `brain_test` database needs pgvector + migration**
   - What we know: `brain_test` database does not yet exist; pgvector extension is available
   - What's unclear: Should `createCheckpointer` / test setup create the test DB and run pgvector extension? Or is this a Wave 0 task?
   - Recommendation: Wave 0 plan (02-00-PLAN.md) should include a test setup step that creates `brain_test`, runs `CREATE EXTENSION IF NOT EXISTS vector`, and runs the database migration.

3. **`@langfuse/langchain` requires `@opentelemetry/api ^1.9.0` as peer dep — production impact?**
   - What we know: Peer dep is `@opentelemetry/api ^1.9.0`; currently at v1.9.1 in npm
   - What's unclear: Whether OTEL API is already installed transitively via another dep
   - Recommendation: Add `@opentelemetry/api` to `devDependencies` of `packages/observability` to satisfy peer dep without shipping OTEL in production bundles.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | AI-01 (PostgresSaver), MEM-01–MEM-04 integration tests | Yes | 14.23 (pgvector/pgvector:pg14) | — |
| pgvector extension | DB-02, MEM-03 (embeddings table) | Yes | 0.8.2 | — |
| `brain_test` database | Integration tests via TEST_DATABASE_URL | Not yet created | — | Create in Wave 0 plan |
| Bun | All packages, `bun test` | Yes | 1.3.2 | — |
| Docker | Development environment | Yes | 24.x (running) | — |
| LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY | OBS-03 (Langfuse tracing) | Not set in current .env | — | Graceful no-op when absent (D-02) |
| LLM API key (e.g., OpenAI) | AI-05 unit tests | Set in .env (LLM_PROVIDER=openai) | — | Mock via `mock.module()` in unit tests |

**Missing dependencies with no fallback:**
- `brain_test` database — must be created in Wave 0 before integration tests can run.

**Missing dependencies with fallback:**
- Langfuse keys — integration test SC-4 requires real keys for dashboard verification; unit tests use mock.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun 1.3.2) |
| Config file | None — `bun test` auto-discovers `*.test.ts` |
| Quick run command | `bun test --filter=<package>` |
| Full suite command | `pnpm test` (via Turborepo) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | PostgresSaver persists checkpoint across 2 invocations with same thread_id | integration | `bun test packages/ai/src/graph/checkpointer.test.ts` | Wave 0 |
| MEM-02 | readProfile / writeProfile reads/writes to `memories` table | integration | `bun test packages/memory/src/long-term.test.ts` | Wave 0 |
| MEM-03 | upsertEmbedding inserts to `embeddings` table; searchSimilar returns top-3 | integration | `bun test packages/memory/src/semantic.test.ts` | Wave 0 |
| MEM-04 | MemoryManager.getContext() exercises all 3 layers in one call | integration | `bun test packages/memory/src/manager.test.ts` | Wave 0 |
| AI-01 | No MemorySaver outside test files (code inspection + integration test uses PostgresSaver) | unit/lint | `bun test packages/ai/src/graph/checkpointer.test.ts` | Wave 0 |
| AI-02 | Subgraph compiled from parent invokes child graph node correctly | unit | `bun test packages/ai/src/graph/subgraph.test.ts` | Wave 0 |
| AI-03 | State with non-JSON-safe values fails gracefully (type enforcement) | unit | `bun test packages/ai/src/graph/state.test.ts` | Wave 0 |
| AI-04 | EMBEDDING_DIMENSIONS env sets vector column size without hardcode | unit | `bun test packages/ai/src/embeddings/factory.test.ts` | Wave 0 |
| AI-05 | createLLM throws ConfigurationError when LLM_PROVIDER absent | unit | `bun test packages/ai/src/llm/factory.test.ts` | Wave 0 |
| TRANS-01 | ITransport interface implemented by WebhookTransport | unit | `bun test packages/transport/src/interface.test.ts` | Wave 0 |
| TRANS-02 | POST to /api/v1/webhook returns 200 with valid BrainEvent | unit | `bun test packages/transport/src/webhook/handler.test.ts` | Wave 0 |
| TRANS-03 | Duplicate X-Request-Id returns 409 on second request | unit | `bun test packages/transport/src/webhook/dedup.test.ts` | Wave 0 |
| TRANS-04 | createTransport("webhook") returns WebhookTransport; unknown value throws | unit | `bun test packages/transport/src/factory.test.ts` | Wave 0 |
| OBS-03 | createTracingCallbacks returns [] when env vars absent; returns [CallbackHandler] when set | unit | `bun test packages/observability/src/tracing.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test <changed-file>.test.ts`
- **Per wave merge:** `pnpm test --filter=@brain-pkg/ai --filter=@brain-pkg/memory --filter=@brain-pkg/transport`
- **Phase gate:** `pnpm test` full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/ai/src/graph/state.test.ts` — covers AI-03
- [ ] `packages/ai/src/graph/checkpointer.test.ts` — covers MEM-01, AI-01
- [ ] `packages/ai/src/graph/subgraph.test.ts` — covers AI-02
- [ ] `packages/ai/src/llm/factory.test.ts` — covers AI-05
- [ ] `packages/ai/src/embeddings/factory.test.ts` — covers AI-04
- [ ] `packages/memory/src/long-term.test.ts` — covers MEM-02
- [ ] `packages/memory/src/semantic.test.ts` — covers MEM-03
- [ ] `packages/memory/src/manager.test.ts` — covers MEM-04 (SC-2)
- [ ] `packages/transport/src/webhook/handler.test.ts` — covers TRANS-02, SC-3
- [ ] `packages/transport/src/webhook/dedup.test.ts` — covers TRANS-03
- [ ] `packages/transport/src/factory.test.ts` — covers TRANS-04
- [ ] `packages/transport/src/interface.test.ts` — covers TRANS-01
- [ ] `packages/observability/src/tracing.test.ts` — covers OBS-03
- [ ] **Test DB setup:** Create `brain_test` database with pgvector extension and Phase 1 migration — prerequisite for all integration tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Webhook auth (HMAC signature) is a v2 requirement; v1 uses X-Request-Id only |
| V3 Session Management | Partial | LangGraph `thread_id` scopes session; no cross-session contamination by design |
| V4 Access Control | No | Single-tenant v1; multi-tenant via DATABASE_NAME env isolation from Phase 1 |
| V5 Input Validation | Yes | `BrainEvent` schema validation on webhook input — use Hono's built-in validator or zod |
| V6 Cryptography | No | No custom crypto; credentials via env vars only |

### Known Threat Patterns for Phase 2 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay attacks via Webhook | Spoofing | X-Request-Id TTL dedup cache (D-03); 409 on duplicate |
| Prompt injection via BrainEvent content | Tampering | Validate `BrainEvent` structure with zod; sanitize before LLM invocation |
| LLM API key exposure in logs | Info Disclosure | Never log `API_KEY`; `createLogger` intentionally excludes secrets (Phase 1 pattern) |
| Checkpoint state poisoning | Tampering | `thread_id` isolation in PostgresSaver; never expose thread_id in responses |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view` 2026-06-11) — all package versions verified
- `packages/database/src/schema/tables.ts` — existing schema structure
- `packages/database/src/pool-manager.ts` — TenantPoolManager pattern
- `packages/observability/src/logger.ts` — createLogger pattern
- `packages/shared/src/errors/index.ts` — BrainError/ConfigurationError base

### Secondary (MEDIUM confidence)
- [orm.drizzle.team/docs/guides/vector-similarity-search](https://orm.drizzle.team/docs/guides/vector-similarity-search) — cosineDistance API
- [langfuse.com/docs/integrations/langchain](https://langfuse.com/docs/integrations/langchain) — CallbackHandler API + conditional pattern
- [langgraphjs.guide/persistence/](https://langgraphjs.guide/persistence/) — PostgresSaver thread_id pattern
- [docs.langchain.com/oss/javascript/migrate/langchain-v1](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) — v1 breaking changes (scoped to `langchain` meta-package)

### Tertiary (LOW confidence)
- WebSearch: "pg node-postgres Bun 1.3.2 compatibility" — pg works with Bun confirmed by multiple 2026 sources, not official Bun docs
- WebSearch: "FakeEmbeddings @langchain/core/utils/testing import path" — confirmed by multiple LangChain references

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via npm registry 2026-06-11
- Architecture: HIGH — patterns verified against official docs; follows Phase 1 conventions
- Pitfalls: HIGH for driver mismatch (npm registry evidence); MEDIUM for Langfuse flush behavior (single doc source)

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (LangGraph and @langfuse packages release frequently; re-verify within 30 days)
