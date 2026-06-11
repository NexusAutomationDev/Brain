# Technology Stack

**Project:** Brain Core — Modular AI Agent Platform
**Researched:** 2026-06-11
**Research Mode:** Ecosystem

---

## Recommended Stack

### Runtime & HTTP

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun | 1.x (latest) | JavaScript runtime + package manager | Faster cold starts, native TS execution, built-in test runner, native SQLite — chosen constraint, well-justified |
| Hono | 4.12.x | HTTP framework | Zero dependencies, ~14KB, first-class Bun support, edge-compatible, RPC for type-safe client contracts |

**Confidence: HIGH** — Hono 4.12.16 is the current stable release (April 2026). Bun is a project constraint and well-validated for this stack by the ecosystem.

---

### Agent Orchestration

**Recommendation: `@langchain/langgraph` (keep the current choice)**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@langchain/langgraph` | 1.3.7 | Agent graph orchestration | Explicit state machines, conditional routing, loop support, human-in-the-loop checkpoints, supervisor/swarm multi-agent patterns |
| `@langchain/core` | latest peer | LLM abstractions | Peer dep of langgraph; tool calling, message types, model adapters |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.1 | Persistent checkpointing to PG | Durable agent state across restarts; uses PostgreSQL already in stack |

**Confidence: MEDIUM-HIGH**

LangGraph 1.3.7 (June 2026) is actively maintained with weekly releases. It has 42,000+ weekly npm downloads. The main competitor is **Mastra**, which reached 1.0 in January 2026. The decision between them is significant:

**LangGraph wins for this project because:**
- The project requires **explicit stateful graph workflows** (qualificação sub-agent, multi-step SDR flow) — LangGraph's graph model maps directly to this
- The project is infrastructure-centric, not frontend-centric — Mastra's main advantage (Next.js/Vercel DX) doesn't apply here
- LangGraph's explicit node/edge model gives fine-grained control over agent state transitions, which matters for a SDK that others will extend
- `@langchain/langgraph-checkpoint-postgres` provides durable state persistence using the PostgreSQL already in the stack, no extra infrastructure

**Mastra is NOT recommended because:**
- Mastra's primary DX wins are for Vercel/Next.js deployments; this project ships Docker images
- Mastra wraps Inngest for durability — adds external service dependency; LangGraph checkpoint to PG is self-contained
- Mastra's ecosystem is younger — fewer answers when hitting edge cases with a novel Brain SDK abstraction
- The project already has LangGraph as a stated constraint; switching costs are high and benefits don't apply here

**What "LangGraph TypeScript lags Python by 4-8 weeks" means for this project:** For the infrastructure phase (v1), this is not relevant — the API surface used (StateGraph, nodes, edges, checkpointers) is stable. For future Brain implementations using cutting-edge patterns, track the Python changelog.

---

### Database & ORM

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | 16.x | Primary datastore | Vector support via pgvector, JSONB for flexible agent state, proven reliability |
| pgvector | 0.8.x | Vector similarity search | RAG and semantic memory; native PG extension avoids separate vector DB |
| `drizzle-orm` | 0.45.x (stable) | ORM + query builder | Lightweight (~7.4KB, 0 deps), TS-native, Bun SQL driver supported natively |
| `drizzle-kit` | latest | Migrations + schema push | CLI for schema management; minor issue with `bun sql` driver for `push` command (use `postgres.js` adapter for drizzle-kit) |
| `pgvector` (npm) | 0.3.0 | pgvector Node.js client | Explicit Bun SQL support documented; integrates with Drizzle ORM |

**Confidence: HIGH**

Drizzle ORM natively supports `drizzle-orm/bun-sql` import path. Example:
```typescript
import { drizzle } from 'drizzle-orm/bun-sql';
const db = drizzle(process.env.DATABASE_URL!);
```

**Important: Drizzle v1.0 is in RC.** As of June 2026, `drizzle-orm@0.45.2` is the latest stable release. v1.0.0-rc.4 is available but not production-recommended yet. Pin to `0.45.x` for now.

**pgvector Drizzle setup pattern:**
```typescript
// Manual extension creation required (not automatic)
await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

// Column definition
embedding: vector('embedding', { dimensions: 1536 })

// HNSW index for similarity search
index('idx_name').using('hnsw', table.embedding.op('vector_cosine_ops'))

// Distance functions available: l2Distance, cosineDistance, innerProduct, l1Distance
```

---

### Transport Layer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Webhook (built-in) | — | Synchronous transport | Hono handler; zero deps; primary integration point for WhatsApp/CRM via ENV selection |
| `amqplib-bun` | 0.10.x | RabbitMQ async transport | Use this fork, NOT the vanilla `amqplib` |

**Confidence: MEDIUM** (for amqplib-bun) / **HIGH** (for webhook)

**Critical finding: `amqplib` has known Bun incompatibilities.** Multiple open GitHub issues document:
- Connection failures in older Bun versions
- "Invalid frame" errors for large messages with Bun's stream implementation (issue #5627, still open)
- RabbitMQ 4.1.0+ requires amqplib >= 0.10.7

**Mitigation strategy:**
1. Use `amqplib-bun` (the Bun-specific fork, v0.10.4 on npm) as the RabbitMQ client
2. Design the transport layer with a clean interface so swapping the underlying client is a 1-file change
3. Alternatively: **use `postgres.js` with a LISTEN/NOTIFY pattern as RabbitMQ fallback** — since PostgreSQL is already in the stack, this eliminates the Bun/RabbitMQ compatibility risk entirely for v1. RabbitMQ can be added in v2 once Bun's stream compatibility matures.

**Architecture decision needed:** The `ENV=TRANSPORT` selector pattern is correct. The interface abstraction must be defined before any transport implementation, so either backend is swappable.

---

### Observability

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| LangSmith | SDK ^0.x | Agent trace visualization | First-class LangGraph integration; automatic trace nesting; no instrumentation code needed in nodes |
| `pino` | ^9.x | Structured logging | Bun-compatible, 5-7x faster than Winston, JSON output for log aggregation |
| `@opentelemetry/sdk-node` | ^0.x | OTEL spans | Optional for infrastructure spans (DB, HTTP); LangSmith exports to OTEL sinks |

**Confidence: MEDIUM**

LangSmith is the recommended observability layer for LangGraph projects. Configuration is environment-variable-based:
```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_key
LANGCHAIN_PROJECT=brain-core
```

Zero code changes required — LangGraph emits traces automatically. LangSmith's "Polly" AI assistant (June 2026 feature) enables asking "Why did the agent loop here?" against trace data.

**For self-hosted/air-gapped deployments:** LangSmith has a self-hosted option. If not viable, `@opentelemetry/sdk-node` with a Jaeger/Grafana Tempo backend is the fallback, but requires manual span instrumentation around LLM calls.

Avoid Winston — it has known Bun compatibility issues and is 5-7x slower than pino.

---

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `bun test` (built-in) | Bun 1.x | Unit + integration tests | Native Jest-compatible API, fastest execution (0.08s vs Vitest 0.9s cold start), no config |
| `@langchain/langgraph-checkpoint-validation` | latest | Checkpointer conformance | Official package to validate custom checkpoint store implementations |

**Confidence: HIGH** (for `bun test`) / **MEDIUM** (for Vitest alternative)

**Use `bun test`, not Vitest.** Reasons:
- Bun test is Jest-compatible API — same `describe`, `it`, `expect`, `mock` syntax
- No config file needed; TypeScript supported natively
- 10x faster than Vitest cold starts in benchmarks
- Vitest + Bun has unresolved compatibility issues (module mocks, inline snapshots)

**LangGraph testing pattern (official recommendation):**
```typescript
// Create fresh graph per test for state isolation
import { MemorySaver } from '@langchain/langgraph';

beforeEach(() => {
  const checkpointer = new MemorySaver();
  graph = myAgentGraph.compile({ checkpointer });
});

// Mock LLM responses for deterministic tests
// Use graph.nodes to test individual nodes in isolation
// Use graph.updateState() + interruptAfter for partial execution testing
```

---

### Build & Packaging

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun workspaces | built-in | Monorepo package linking | Native workspace support, no Turborepo/Lerna needed for package linking |
| Docker (Bun base image) | `oven/bun:1` | Brain image packaging | Official Bun Docker image; minimal, distroless-compatible |

**Confidence: HIGH**

Monorepo workspace config:
```json
// package.json (root)
{
  "workspaces": ["apps/*", "packages/*"]
}
```

Docker base image:
```dockerfile
FROM oven/bun:1 AS base
# Each Brain image extends this
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Agent orchestration | `@langchain/langgraph` | Mastra | Mastra optimized for Vercel/Next.js; adds Inngest dependency; this project ships Docker images, not serverless functions |
| Agent orchestration | `@langchain/langgraph` | Vercel AI SDK | Streaming UI library, not an orchestration framework; no graph model, no durable state |
| ORM | Drizzle | Prisma | Prisma requires client generation step, heavier, slower with Bun cold starts |
| ORM | Drizzle | TypeORM | Decorator-based, poor Bun compatibility, outdated patterns |
| Testing | `bun test` | Vitest | Unresolved Bun compatibility issues; no benefit over `bun test` for this stack |
| Logging | Pino | Winston | Winston has Bun compatibility issues; 5-7x slower |
| RabbitMQ client | `amqplib-bun` | `amqplib` | Open Bun incompatibility bugs (invalid frame errors for large messages) |
| Message queue | RabbitMQ (v2) | BullMQ + Redis | BullMQ works well with Bun but adds Redis dependency; RabbitMQ is specified requirement |
| Vector store | pgvector (in PG) | Pinecone / Qdrant | Avoids separate infrastructure; PG already in stack; sufficient for Brain scale |

---

## Installation

```bash
# Core runtime + framework
bun add hono

# AI orchestration
bun add @langchain/langgraph @langchain/core @langchain/openai
bun add @langchain/langgraph-checkpoint-postgres

# Database
bun add drizzle-orm pgvector
bun add -D drizzle-kit

# Transport (RabbitMQ path)
bun add amqplib-bun

# Observability
bun add pino langsmith

# Dev dependencies
bun add -D @types/bun typescript
```

---

## Critical Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `amqplib` Bun incompatibility | HIGH | Use `amqplib-bun` fork; design transport interface for easy swap; consider PG LISTEN/NOTIFY for v1 |
| Drizzle v1.0 RC instability | MEDIUM | Pin to `0.45.x` stable; monitor v1.0 GA release |
| LangGraph.js TypeScript lag behind Python | LOW | Only affects cutting-edge features; core API (StateGraph, nodes, edges, checkpointers) is stable |
| `bun:sql` driver bug (stuck connection after constraint error) | MEDIUM | Use `postgres.js` as Drizzle driver instead of `bun:sql`; `postgres.js` is cross-runtime and has no known Bun issues |
| pgvector HNSW index tuning | LOW | Set `m=16, ef_construction=64` as defaults; increase for production based on vector count |

---

## Sources

- `@langchain/langgraph` npm (v1.3.7, June 2026): https://www.npmjs.com/package/@langchain/langgraph
- LangGraph 1.0 GA announcement: https://changelog.langchain.com/announcements/langgraph-1-0-is-now-generally-available
- LangGraph.js testing docs: https://docs.langchain.com/oss/javascript/langgraph/test
- Mastra vs LangGraph comparison (2026): https://particula.tech/blog/mastra-vs-langgraph-vs-vercel-ai-sdk-typescript-agents
- Mastra vs LangGraph xpay.sh: https://www.xpay.sh/resources/agentic-frameworks/compare/langgraph-vs-mastra/
- Hono releases (v4.12.16): https://github.com/honojs/hono/releases
- Hono + Bun guide: https://hono.dev/docs/getting-started/bun
- Drizzle ORM pgvector guide: https://orm.drizzle.team/docs/guides/vector-similarity-search
- Drizzle ORM Bun SQL: https://orm.drizzle.team/docs/connect-bun-sql
- Drizzle ORM PG extensions: https://orm.drizzle.team/docs/extensions/pg
- Drizzle ORM v1.0-rc release notes: https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2
- pgvector-node (v0.3.0, supports Bun SQL): https://github.com/pgvector/pgvector-node
- amqplib Bun issue (invalid frame, open): https://github.com/oven-sh/bun/issues/5627
- amqplib Bun connection issue: https://github.com/oven-sh/bun/issues/4791
- amqplib-bun package: https://socket.dev/npm/package/amqplib-bun
- RabbitMQ 4.1.0 release (amqplib >= 0.10.7 required): https://www.rabbitmq.com/blog/2025/04/15/rabbitmq-4.1.0-is-released
- LangSmith TypeScript tracing: https://docs.smith.langchain.com/tracing/integrations/typescript
- Bun test runner docs: https://bun.com/docs/test
- Bun test vs Vitest 2026: https://www.pkgpulse.com/blog/bun-test-vs-vitest-vs-jest-2026
- Bun + postgres 2026: https://www.pkgpulse.com/guides/bun-sql-vs-postgres-js-vs-drizzle-postgres-stack-2026
- `@langchain/langgraph-checkpoint-postgres` (v1.0.1): https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres
