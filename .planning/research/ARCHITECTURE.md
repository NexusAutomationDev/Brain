# Architecture Patterns: Brain Core

**Domain:** Modular AI agent platform (monorepo)
**Researched:** 2026-06-11
**Overall confidence:** HIGH (LangGraph TypeScript docs) / MEDIUM (monorepo tooling)

---

## Recommended Architecture

Brain Core follows a layered plugin-host architecture: a set of infrastructure packages forms a stable base, and individual Brain implementations (SDR, Suporte, etc.) are assembled by wiring their config into the Brain SDK host. No Brain rewrites the base — it only declares what it needs.

```
┌────────────────────────────────────────────────────────────────┐
│                        Brain Application                        │
│  (apps/brain-sdr, apps/brain-support, …)                        │
│  • BrainConfig: id, prompts, tools[], memoryConfig, graph()    │
│  • Dockerfile (runtime: Bun)                                   │
└────────────┬───────────────────────────────────────────────────┘
             │ implements IBrain
             ▼
┌────────────────────────────────────────────────────────────────┐
│                      packages/core (SDK host)                   │
│  • IBrain interface + BrainRegistry                            │
│  • BrainRunner: wire transport → graph → memory → response     │
│  • ToolsRegistry: per-Brain enable/disable                     │
└───┬────────┬──────────┬─────────────┬──────────────────────────┘
    │        │          │             │
    ▼        ▼          ▼             ▼
packages/ packages/  packages/    packages/
  ai      memory   embeddings    transport
(LangGraph)(3-layer)(PGVector)  (Webhook/RabbitMQ)
    │        │          │             │
    └────────┴──────────┴─────────────┘
                        │
                        ▼
             packages/database (Drizzle + PostgreSQL)
                        │
                        ▼
             packages/shared (types, utils, errors)
             packages/observability (logging, tracing)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `packages/shared` | Domain types, Zod schemas, utility functions, error classes | All packages (no inbound deps) |
| `packages/database` | Drizzle schema, migrations, connection pool (1 DB per tenant via `DATABASE_NAME` env) | `shared` only |
| `packages/observability` | Structured logger (pino), OpenTelemetry spans, health-check endpoint | `shared` |
| `packages/embeddings` | PGVector store, embed-text, similarity search (RAG) | `database`, `shared` |
| `packages/memory` | 3-layer memory: short-term (in-graph messages), long-term (DB rows), semantic (vector retrieval). Exposes `MemoryManager` | `database`, `embeddings`, `shared` |
| `packages/transport` | Inbound adapters: Webhook (Hono route) and RabbitMQ consumer. Selected by `TRANSPORT` env. Normalizes to a `BrainEvent` | `shared`, `observability` |
| `packages/ai` | LangGraph StateGraph factory, tool helpers, `@langchain/langgraph-checkpoint-postgres`, multi-agent patterns | `shared`, `database` |
| `packages/core` | `IBrain` interface, `BrainRegistry`, `BrainRunner` (wires all packages), `ToolsRegistry` | All packages |
| `apps/brain-*` | Concrete Brain: declares `BrainConfig` implementing `IBrain`, exports graph builder, tools list, prompt IDs | `core` (and transitively all packages) |

**Strict rule:** packages never import from `apps/`. Apps import from `packages/`. `shared` has no inbound package dependencies.

---

## Data Flow: Message In → Response Out

```
1. INBOUND (packages/transport)
   External source (webhook POST or RabbitMQ message)
   → transport adapter normalizes to BrainEvent { userId, sessionId, tenantId, text, metadata }

2. DISPATCH (packages/core → BrainRunner)
   BrainRunner receives BrainEvent
   → resolves Brain from BrainRegistry by tenantId/brainType
   → creates LangGraph config { thread_id: sessionId, configurable: { tenantId } }

3. MEMORY HYDRATION (packages/memory → packages/ai)
   Before invoking graph:
   a. Short-term: LangGraph checkpointer (PostgresSaver) auto-loads messages for thread_id — no explicit call needed
   b. Long-term: MemoryManager.getProfile(userId) → structured facts injected into system prompt
   c. Semantic: EmbeddingsStore.search(text, topK=5) → relevant chunks appended to context

4. GRAPH EXECUTION (packages/ai)
   LangGraph StateGraph.invoke(event, config)
   → nodes execute: tool calls, LLM calls, conditional edges
   → if Brain has sub-agent (e.g. SDR qualification): supervisor node calls subgraph
   → subgraph returns to parent graph via shared state key

5. MEMORY PERSISTENCE (packages/memory)
   After graph completes:
   a. Short-term: checkpointer auto-saves state (messages + graph position) — no explicit call
   b. Long-term: MemoryManager.upsert(userId, extractedFacts) — structured rows in DB
   c. Semantic: EmbeddingsStore.upsert(sessionId, turnText) — async, non-blocking

6. RESPONSE (packages/transport)
   BrainRunner returns response text
   → transport sends reply: HTTP response (webhook) or publish to reply queue (RabbitMQ)

7. OBSERVABILITY (packages/observability)
   All steps emit structured log + OTEL span
   BrainRunner records: event_id, brain_id, duration_ms, token_count, memory_ops
```

---

## Key Patterns

### Pattern 1: IBrain Plugin Interface

Every Brain must implement `IBrain`. This is the only contract `BrainRunner` depends on.

```typescript
// packages/core/src/brain.interface.ts

import type { StateGraph } from "@langchain/langgraph";
import type { StructuredTool } from "@langchain/core/tools";

export interface BrainConfig {
  /** Stable identifier: "sdr", "support", "cs" */
  id: string;

  /** Display name */
  name: string;

  /** Prompt IDs to load from DB at startup (not inlined — all prompts live in DB) */
  promptKeys: string[];

  /** Tool constructors this Brain enables; BrainRunner registers them */
  tools: StructuredTool[];

  /**
   * Factory that returns a compiled LangGraph StateGraph.
   * Receives resolved prompts + ToolsRegistry so Brain can wire its graph.
   */
  buildGraph(ctx: BrainBuildContext): StateGraph<any, any>;

  /** Optional: memory tuning per Brain */
  memoryConfig?: Partial<MemoryConfig>;
}

export interface BrainBuildContext {
  prompts: Record<string, string>;      // resolved from DB
  tools: StructuredTool[];              // from ToolsRegistry
  checkpointer: BaseCheckpointSaver;    // PostgresSaver instance
}

export interface IBrain {
  config: BrainConfig;
}
```

**Rationale:** The pattern avoids class inheritance chains. A Brain is a plain config object — declarative, easy to test, easy to serialize. This mirrors how Mastra and Google ADK approach agent registration: functional composition over OOP inheritance.

### Pattern 2: Brain SDK Registration

```typescript
// packages/core/src/registry.ts

export class BrainRegistry {
  private brains = new Map<string, IBrain>();

  register(brain: IBrain): void {
    this.brains.set(brain.config.id, brain);
  }

  resolve(id: string): IBrain {
    const brain = this.brains.get(id);
    if (!brain) throw new BrainNotFoundError(id);
    return brain;
  }
}
```

Apps register at startup:
```typescript
// apps/brain-sdr/src/index.ts
import { registry } from "@brain/core";
import { SdrBrain } from "./sdr.brain";

registry.register(SdrBrain);
```

### Pattern 3: Multi-Agent (Parent Brain → Qualification Subgraph)

LangGraph's subgraph-as-node pattern handles the SDR qualification flow. The parent graph contains a node that invokes the qualification subgraph and merges results back into parent state.

```
Parent SDR Graph:
  START
    → conversation_node     (talk to lead, collect messages)
    → should_qualify?       (conditional edge: check qualification trigger)
       ├─ no  → conversation_node (loop)
       └─ yes → qualification_node (invoke subgraph)
    → qualification_node    (subgraph: profile analysis, budget, fit, timing)
    → merge_qualification   (inject subgraph output into parent state)
    → conversation_node     (continue with qualified context)
    → END
```

Shared state key bridges the layers:

```typescript
// The parent state includes a channel for subgraph output
const ParentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesReducer }),
  qualificationResult: Annotation<QualificationResult | null>({
    default: () => null,
    reducer: (_, newVal) => newVal,  // last-write wins
  }),
});
```

The qualification subgraph reads from `messages` (shared with parent), writes to `qualificationResult`. When the subgraph returns, `qualificationResult` is available in the parent's next nodes.

**Confidence:** HIGH — this is the documented LangGraph pattern for hierarchical agent teams.

### Pattern 4: 3-Layer Memory Separation

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Short-Term (In-Graph / Session)                 │
│ Technology: LangGraph checkpointer → PostgresSaver       │
│ Stores: Message history for current thread_id           │
│ Scope: One conversation session                         │
│ Who manages: LangGraph automatically (no explicit code) │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Long-Term (Structured Profile)                  │
│ Technology: Drizzle + PostgreSQL table (user_profiles)  │
│ Stores: Extracted facts — name, role, preferences,      │
│         previous outcomes, known objections             │
│ Scope: Persists across all sessions for a userId        │
│ Who manages: MemoryManager (explicit read/write)        │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Semantic (Vector / RAG)                         │
│ Technology: PGVector extension + packages/embeddings    │
│ Stores: Embeddings of conversation turns, documents,    │
│         product knowledge, objection scripts            │
│ Scope: Searchable by semantic similarity across all     │
│         sessions and content                            │
│ Who manages: EmbeddingsStore (query on hydration,       │
│              upsert after turn — async fire-and-forget) │
└─────────────────────────────────────────────────────────┘
```

**Critical separation:** Layer 1 (checkpointer) is LangGraph's responsibility — do not replicate it manually in a DB table. Layer 2 and Layer 3 are explicit MemoryManager calls in `BrainRunner`, before and after graph invocation.

### Pattern 5: Transport Abstraction

```typescript
// packages/transport/src/adapters/base.ts
export interface TransportAdapter {
  /** Called by BrainRunner to start listening */
  start(handler: (event: BrainEvent) => Promise<BrainResponse>): Promise<void>;
  stop(): Promise<void>;
}

// BrainEvent is transport-agnostic
export interface BrainEvent {
  id: string;
  userId: string;
  sessionId: string;       // maps to LangGraph thread_id
  tenantId: string;        // maps to DATABASE_NAME
  brainId: string;
  text: string;
  metadata: Record<string, unknown>;
}
```

Transport selection at startup:
```typescript
const adapter = process.env.TRANSPORT === "rabbitmq"
  ? new RabbitMQAdapter(config)
  : new WebhookAdapter(app);  // Hono app
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Putting Prompts in Code
**What goes wrong:** Prompt updates require redeploy. Version drift across Brain instances.
**Instead:** All prompts stored in `agent_prompts` table, loaded at startup via `promptKeys`. Brain config only holds the key names.

### Anti-Pattern 2: Manually Implementing Short-Term Memory
**What goes wrong:** Duplicates LangGraph's built-in checkpointing. Creates two sources of truth for message history. Causes state desync bugs.
**Instead:** Use `@langchain/langgraph-checkpoint-postgres` exclusively for Layer 1. Only layers 2 and 3 need explicit MemoryManager code.

### Anti-Pattern 3: Apps Importing From Other Apps
**What goes wrong:** Cross-app coupling breaks independent Docker builds.
**Instead:** Shared code always lives in a package. Each app depends only on packages.

### Anti-Pattern 4: Fat Core Package
**What goes wrong:** `packages/core` becomes a dumping ground for everything. Circular deps emerge.
**Instead:** Core only contains `IBrain`, `BrainRegistry`, `BrainRunner`, and `ToolsRegistry`. Database access stays in `packages/database`, AI wiring in `packages/ai`.

### Anti-Pattern 5: Single Thread ID Per User
**What goes wrong:** All conversations for a user share one LangGraph thread — history bleeds across sessions.
**Instead:** `sessionId` (a new UUID per conversation) maps to `thread_id`. `userId` maps to Layer 2 profile. These are distinct concepts.

---

## Monorepo Tooling Decision

**Use Turborepo** with Bun workspaces.

**Rationale:**
- For 8-10 packages + 3-5 apps (this size), Turborepo provides task caching and build ordering with minimal configuration overhead.
- Nx is better for 50+ package monorepos needing architectural guardrails and plugin ecosystem. Overkill here.
- Bun workspaces handle package linking. Turborepo handles task orchestration and caching on top.
- The `"dependsOn": ["^build"]` pattern in `turbo.json` automatically orders builds: `shared` → `database` → `memory/embeddings/transport/ai` → `core` → `apps`.

**Root package.json:**
```json
{
  "packageManager": "bun@1.x",
  "workspaces": ["apps/*", "packages/*"]
}
```

**turbo.json (key excerpt):**
```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

This guarantees build order: `shared` first (no deps), then database, then the domain packages, then core, then apps.

---

## Suggested Build Order (Roadmap Dependency Sequence)

This is the order that eliminates blocked work — each phase's output is a prerequisite for the next.

```
Phase 1: Foundation Layer
  packages/shared → packages/database → packages/observability
  (no deps; pure TypeScript types + DB schema + logger)

Phase 2: Storage Layer
  packages/embeddings → packages/memory
  (depends on database + shared)

Phase 3: AI Layer
  packages/ai → packages/transport
  (depends on database + shared; independent of each other)

Phase 4: Core SDK
  packages/core
  (depends on all packages; IBrain interface, BrainRunner, ToolsRegistry)

Phase 5: Validation Brain
  apps/brain-* (one minimal Brain implementation)
  (depends on core; proves the SDK contract works end-to-end)
```

Each phase can be shippable independently. The validation Brain in Phase 5 is not a production Brain — it is a test harness Brain (e.g., `apps/brain-echo`) that exercises every package integration.

---

## Scalability Considerations

| Concern | At 1 tenant | At 10 tenants | At 100+ tenants |
|---------|-------------|---------------|-----------------|
| DB isolation | 1 DB per tenant via `DATABASE_NAME` | Same — Drizzle pool per DB | Migrate to `tenant_id` column + row-level security |
| Memory | PG checkpointer per DB | Same | Add Redis layer for hot session cache |
| Transport | Webhook per tenant | Webhook or RabbitMQ | RabbitMQ with per-tenant routing keys |
| Brain instances | 1 Docker image | Same image, env-differentiated | Kubernetes with tenant-scoped deployments |

---

## Sources

- LangGraph TypeScript multi-agent guide: https://langgraphjs.guide/multi-agent/
- LangGraph TypeScript persistence guide: https://langgraphjs.guide/persistence/
- LangGraph hierarchical agents: https://langchain-ai.github.io/langgraph/tutorials/multi_agent/hierarchical_agent_teams/
- `@langchain/langgraph-checkpoint-postgres` on npm: https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres
- Turborepo structuring guide: https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository
- Bun workspace configuration: https://bun.com/docs/guides/install/workspaces
- Turborepo + Bun CI/CD pattern: https://www.sawyercutler.com/blog/building-a-cicd-pipeline-with-bun-workspaces-changesets-turborepo-and-npm-provenance/
- AI agent three-layer memory architecture: https://tacnode.io/post/ai-agent-memory-architecture-explained
- Mastra agent + memory pattern (2026): https://www.generative.inc/mastra-ai-the-complete-guide-to-the-typescript-agent-framework-2026
- WAIaaS 14-package monorepo structure: https://dev.to/walletguy/14-package-monorepo-how-we-structured-waiaas-for-ai-agent-builders-40d5
- Monorepo tools comparison 2026: https://daily.dev/blog/monorepo-turborepo-vs-nx-vs-bazel-modern-development-teams/
