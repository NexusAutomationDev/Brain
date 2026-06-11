# Project Research Summary

**Project:** Brain Core — Modular AI Agent Platform
**Domain:** B2B SaaS agentic infrastructure platform (TypeScript/Bun monorepo)
**Researched:** 2026-06-11
**Confidence:** HIGH

## Executive Summary

Brain Core is a plugin-host infrastructure platform: a stable set of shared packages forms the base, and individual Brain implementations (SDR, Support, CS, etc.) are assembled by wiring a `BrainConfig` into the SDK host. The reference architecture is a layered monorepo — `packages/shared` → `packages/database` → domain packages (`memory`, `embeddings`, `ai`, `transport`) → `packages/core` (SDK host) → `apps/brain-*` (concrete Brains). This dependency order is the correct build sequence. Every shortcut that inverts this graph creates downstream coupling that forces rewrites. The Brain SDK contract (`IBrain` interface + `BrainConfig`) must be stable from day one because changing it later forces a rewrite of every Brain ever built on it.

The recommended stack has no surprises: Bun runtime, Hono HTTP, LangGraph 1.3.7 for orchestration, Drizzle ORM 0.45.x on PostgreSQL 16 with pgvector 0.8.x. LangGraph beats Mastra for this project because it targets Docker deployments (not Vercel), needs explicit stateful graph workflows (not a Next.js DX story), and the sub-agent pattern for SDR qualification maps directly to LangGraph's subgraph-as-node. Two non-obvious deviations from naive choices: use `pnpm` for package management (not `bun install`) to avoid a January 2026 regression, and use `postgres.js` as the Drizzle driver (not Bun's native `bun:sql`) to avoid a stuck-connection bug after constraint errors.

The single most dangerous risk category is Phase 1 state design decisions that become permanent. LangGraph state schemas, embedding dimension, and checkpoint table strategy are all one-way doors — they cannot be changed without migrating production data or breaking in-flight conversations. The mitigation is to make these decisions explicitly, document them as constants, and add startup assertions that crash loudly if configuration drifts. Secondary risks are operational: connection pool explosion in multi-tenant mode and checkpoint table unbounded growth will both surface within weeks of real usage if not addressed in the foundation phase.

---

## Key Findings

### Recommended Stack

The stack is highly validated with no major deviations from the project constraints. The only actionable deviations from what a developer would reach for by default are: (1) prefer `pnpm` over `bun install` for monorepo package management due to a documented Bun workspace performance regression; (2) use `amqplib-bun` (not `amqplib`) for RabbitMQ, or defer RabbitMQ entirely to v2 in favor of PostgreSQL `LISTEN/NOTIFY` which eliminates the Bun stream compatibility risk; (3) use `postgres.js` as the Drizzle DB driver rather than `bun:sql` to avoid a stuck-connection bug after constraint violations.

**Core technologies:**

| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| Bun | 1.x (runtime only) | TypeScript execution, test runner | Project constraint; fast cold starts, native TS |
| pnpm | latest | Monorepo package management | Bun workspace has January 2026 perf regression |
| Hono | 4.12.x | HTTP framework | Zero deps, Bun-native, RPC support |
| `@langchain/langgraph` | 1.3.7 | Agent graph orchestration | Explicit state machines, subgraph support, Postgres checkpointer |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.1 | Durable agent state | Persists checkpoint to existing PG; required for production |
| drizzle-orm | 0.45.x (stable) | ORM + query builder | Lightweight, Bun-compatible, TS-native; pin to 0.45.x (v1 RC is unstable) |
| postgres.js | latest | Drizzle DB driver | Use instead of `bun:sql`; avoids stuck-connection bug |
| PostgreSQL | 16.x | Primary datastore | Vector support via pgvector, JSONB agent state |
| pgvector | 0.8.x extension + 0.3.0 npm | Semantic memory / RAG | Avoids separate vector DB; native PG |
| Turborepo | latest | Build orchestration + caching | Task ordering for 8-10 packages; Bun workspaces handle linking |
| pino | ^9.x | Structured logging | 5-7x faster than Winston; Bun-compatible |
| LangSmith | SDK ^0.x | Agent trace visualization | Zero-code LangGraph integration; env-var only config |
| `bun test` | built-in | Unit + integration testing | Jest-compatible, 10x faster cold start than Vitest |

**Defer or avoid:** Winston (Bun incompatibility), Vitest (Bun compatibility issues), Mastra (Vercel/Next.js DX story), Prisma (client generation overhead), TypeORM (decorators, poor Bun compat), Pinecone/Qdrant (unnecessary infrastructure when PG is in the stack).

---

### Expected Features

**Table stakes — must ship in v1 (infrastructure core):**

| Feature | Why non-negotiable |
|---------|-------------------|
| Brain SDK / `IBrain` interface + `BrainRegistry` | Without this contract, every Brain is a snowflake; changing it later rewrites everything |
| PostgreSQL schema (agent_state, memories, embeddings, prompts) | All memory layers, prompt storage, and checkpointing depend on this |
| 3-layer memory: short-term (LangGraph checkpointer), long-term (structured DB rows), semantic (PGVector) | Agents without long-term memory forget clients between sessions; semantic memory enables RAG |
| Tools Registry with per-Brain enable/disable scoping | Least-privilege tooling is a production expectation; binary enable/disable sufficient for v1 |
| Transport layer: Webhook + RabbitMQ, ENV-selected | Agents that block HTTP for LLM reasoning timeout; async transport is required for reliability |
| Sub-agent spawning via LangGraph subgraph-as-node | Required for SDR qualification flow — parent Brain → qualification subgraph → result merge |
| Prompt storage in database | Updates without redeploy; unacceptable for business users to require CI/CD for prompt tuning |
| Multi-tenancy: 1 DB per client via `DATABASE_NAME` env | Data isolation is non-negotiable for B2B; database-per-tenant is the simplest correct isolation |
| Structured logging + health check endpoint | Required for Docker/K8s liveness probes; debugging agent failures without logs is impossible |
| Docker packaging per Brain | This IS the distribution model — not optional |

**Differentiators for v2+:**

- Vertical Brain implementations (SDR, Support, CS) — these are what customers actually buy
- Domain-specific embedding models per Brain type — improves task performance substantially
- Flows as database artifacts — runtime reconfiguration without redeploy
- Brain composition / routing orchestrator — Brain-of-Brains pattern
- Full OpenTelemetry tracing — LangSmith + structured logging is sufficient for v1
- Evaluation suite — needs production data before evals are meaningful

**Explicit anti-features for v1 (do not build):**

- Management UI — no validated users; add in v3+
- LICENSE_KEY enforcement — no billing yet; add when first Brain is in production
- Row-level multi-tenancy (tenant_id columns) — correct implementation has huge surface area; 1-DB-per-tenant gives equivalent isolation now
- Multi-LLM provider switching at runtime — no customer need; hard-pin to one provider
- Real-time streaming UI — batch response via Webhook/MQ is sufficient
- Custom orchestration layer competing with LangGraph

---

### Architecture Approach

Brain Core follows a strict layered plugin-host architecture with unidirectional dependencies. `packages/shared` (types, Zod schemas, errors) has no inbound dependencies. `packages/database` depends only on `shared`. Domain packages (`memory`, `embeddings`, `ai`, `transport`, `observability`) depend on `database` and `shared`. `packages/core` (SDK host: `IBrain`, `BrainRegistry`, `BrainRunner`, `ToolsRegistry`) depends on all domain packages. Apps (`apps/brain-*`) depend only on `core` — never on each other. The rule "apps never import from other apps" is critical for independent Docker builds.

**Major components and responsibilities:**

| Component | Responsibility |
|-----------|---------------|
| `packages/shared` | Domain types, Zod schemas, error classes — no dependencies |
| `packages/database` | Drizzle schema, migrations, per-tenant connection pool cache (Map with LRU cap) |
| `packages/observability` | Pino structured logger, health check, OTEL spans |
| `packages/embeddings` | PGVector store, embed-text, similarity search |
| `packages/memory` | `MemoryManager`: short-term (LangGraph checkpointer, automatic), long-term (explicit DB rows), semantic (explicit PGVector ops) |
| `packages/transport` | `TransportAdapter` interface; `WebhookAdapter` (Hono) and `RabbitMQAdapter` (`amqplib-bun`); normalized `BrainEvent` |
| `packages/ai` | LangGraph `StateGraph` factory, tool helpers, `PostgresSaver` checkpointer wiring |
| `packages/core` | `IBrain` interface, `BrainRegistry`, `BrainRunner` (wires all packages), `ToolsRegistry` |
| `apps/brain-*` | Declares `BrainConfig` (id, promptKeys, tools, `buildGraph()`, `memoryConfig`); one Dockerfile per Brain |

**Key architectural decisions validated by research:**

1. `BrainEvent` normalizes across transports — `sessionId` → `thread_id`, `tenantId` → `DATABASE_NAME`
2. Short-term memory (Layer 1) is owned entirely by LangGraph's `PostgresSaver` — never replicate this manually
3. Long-term memory (Layer 2) and semantic memory (Layer 3) are explicit `MemoryManager` calls in `BrainRunner` before/after graph invocation
4. `sessionId` (new UUID per conversation) maps to `thread_id`; `userId` maps to Layer 2 profile — these are distinct concepts
5. Sub-agent pattern: qualification subgraph invoked as a node in the parent SDR graph; parent state includes a `qualificationResult` channel with last-write-wins reducer
6. Per-tenant connection pool: `Map<tenantId, DrizzleDB>` with LRU eviction cap — never create a pool per request

---

### Critical Pitfalls

**Top 5 pitfalls that will block the project if not addressed in Phase 1:**

1. **LangGraph state serialization failures** — State schemas with `Set`, `Map`, `Date`, `Buffer`, or custom class instances crash checkpointing with opaque errors. Prevention: use only JSON-safe primitives in all state definitions (`string[]` not `Set<string>`, ISO strings not `Date`). Add a CI test that calls `JSON.stringify()` on every state type. Define this rule before writing any state schema.

2. **MemorySaver in non-local environments** — LangGraph examples default to `MemorySaver`. In any deployed environment it wipes all conversation state on container restart. Prevention: `PostgresSaver` (`@langchain/langgraph-checkpoint-postgres`) must be the only checkpointer in all non-test code from day one. Use `MemorySaver` only in `beforeEach()` test setup.

3. **PGVector embedding dimension lock-in** — The embedding column dimension is baked into the schema (`vector(1536)`). Switching providers mid-deployment without a schema migration causes hard write failures. Prevention: decide on a single provider and dimension before writing any migration. Document it as a constant (`EMBEDDING_DIM = 1536`). Add a startup assertion that queries `pg_attribute` and crashes loudly if the configured dimension mismatches the column.

4. **LangGraph state schema evolution breaking existing threads** — Renaming a field, removing a field, or adding a required field without a default silently produces `undefined` values in active threads. LangGraph has no migration layer. Prevention: add `schema_version: number` to every state definition from the start. Treat state changes like DB migrations — write a transformation function. Always add new fields with defaults, never rename.

5. **Per-tenant connection pool explosion** — A `Map<tenantId, Pool>` without a cap opens `tenants × pool_size` connections. At 50 tenants with default pool sizes, this hits PostgreSQL's connection limit. Prevention: implement the tenant pool cache with an LRU cap (max 20 pools), size each pool at 2-5 connections, add a global connection count metric before writing the first request handler.

**Additional high-priority pitfalls (implement in Phase 1):**

- **Drizzle client recreation per request** — calling `drizzle(new Pool(...))` inside a request handler leaks connections. Cache Drizzle instances at module level in a `Map<tenantId, DrizzleDB>`.
- **TypeScript path aliases broken at runtime** — `tsconfig.json` `paths` are not resolved by Bun at runtime. Use `bunfig.toml` `[alias]` section or Node.js subpath imports. Establish this before aliases proliferate.
- **LangChain peer dependency version drift** — pin exact versions for all `@langchain/*` packages. Never use caret ranges. Update all `@langchain/*` packages together in a single commit.
- **Bun workspace install performance regression** — use `pnpm` for package management (not `bun install`). This is a documented January 2026 regression in Bun's workspace install.

---

## Implications for Roadmap

The architecture research defines the correct build order explicitly. Each phase's output is a hard prerequisite for the next. Skipping steps or building in parallel across layers creates integration debt that manifests as rewrites.

### Phase 1: Monorepo Foundation + Database Layer

**Rationale:** `packages/shared` and `packages/database` are zero-dependency roots. Every other package imports from them. The connection pool architecture, state schema conventions, and embedding dimension must be locked here — all are one-way doors.

**Delivers:** Working monorepo with Turborepo + pnpm workspaces, TypeScript config with runtime-safe path aliases, Drizzle schema with all tables (agent_state, memories, embeddings/PGVector, prompts, user_profiles), per-tenant connection pool cache, database migrations, `packages/observability` (pino logger + health check endpoint).

**Must address (pitfall prevention):**
- Establish JSON-safe state schema conventions and CI test
- Choose and document embedding dimension as a constant
- Implement per-tenant connection pool with LRU cap
- Set path alias resolution via `bunfig.toml` (not just tsconfig)
- Pin exact `@langchain/*` versions in root package.json
- Configure `pnpm` as package manager, `bun` as runtime only

**Research flag:** Standard patterns — no additional research needed.

---

### Phase 2: Domain Packages (Memory, Embeddings, AI, Transport)

**Rationale:** These packages depend on the foundation layer but are independent of each other and can be built in parallel within the phase. They must exist before `packages/core` can wire them together.

**Delivers:**
- `packages/embeddings`: PGVector store with HNSW index (`m=16, ef_construction=200`), embed-text, similarity search
- `packages/memory`: `MemoryManager` with all 3 layers; Layer 1 via `PostgresSaver` (not `MemorySaver`); Layers 2 and 3 via explicit DB ops
- `packages/ai`: LangGraph `StateGraph` factory with `PostgresSaver` wired; sub-agent pattern (subgraph-as-node); tool helpers
- `packages/transport`: `TransportAdapter` interface; `WebhookAdapter` (Hono); `RabbitMQAdapter` (`amqplib-bun`) with transport selected by `TRANSPORT` env; idempotency key handling on Webhook

**Must address (pitfall prevention):**
- Only embed semantically rich content in PGVector — never raw conversation messages
- Set `recursionLimit` explicitly in all graph configurations (50 for simple agents, 100 for agents with subgraphs)
- Define reducers for all state keys that could be written by parallel nodes
- Implement tool retry with hard cap (max 3 retries) and structured error returns to LLM
- Pass parent checkpointer to qualification subgraph — do not compile subgraph independently

**Research flag:** `amqplib-bun` Bun stream compatibility needs validation during implementation. If issues arise, fall back to PostgreSQL `LISTEN/NOTIFY` for v1.

---

### Phase 3: Brain SDK Core + Tools Registry

**Rationale:** `packages/core` is the integration layer. It depends on all domain packages and cannot be built before they exist. This is the most architecturally sensitive package — the `IBrain` interface defined here is the contract that all future Brains must implement.

**Delivers:**
- `IBrain` interface + `BrainConfig` type (id, name, promptKeys, tools, `buildGraph()`, optional `memoryConfig`)
- `BrainRegistry` — Map-based registry with `register()` and `resolve()` by Brain ID
- `BrainRunner` — wires transport event → memory hydration → graph execution → memory persistence → response
- `ToolsRegistry` — per-Brain tool registration with binary enable/disable; tool call tracking in state for loop detection
- Prompt loading from DB at startup via `promptKeys`

**Must address (pitfall prevention):**
- `IBrain` interface stability is paramount — any change after this phase forces rewrite of all Brains
- `BrainRunner` must not use `MemorySaver` under any circumstances
- `BrainEvent.sessionId` and `userId` must remain distinct concepts throughout

**Research flag:** Standard patterns (LangGraph plugin patterns are well-documented). No additional research needed.

---

### Phase 4: Validation Brain + Docker Packaging

**Rationale:** A minimal `apps/brain-echo` or `apps/brain-test` that implements `IBrain` and exercises every package integration end-to-end. This is not a production Brain — it is an integration test harness that proves the SDK contract works. Docker packaging belongs here because it is the distribution model and must be validated before any real Brain is built.

**Delivers:**
- `apps/brain-echo` — minimal Brain that registers a tool, uses memory, handles a webhook event, and returns a response
- Multi-stage Dockerfile per Brain (from `oven/bun:1`)
- Full integration test coverage: transport → BrainRunner → LangGraph → memory layers → response
- Checkpoint table pruning job (scheduled DELETE of rows older than 30 days)
- Startup assertion: embedding dimension matches `EMBEDDING_DIM` env var

**Must address (pitfall prevention):**
- Deploy to staging, restart mid-conversation, verify agent resumes correctly (validates `PostgresSaver`)
- Load test with 10+ simulated tenants and watch `pg_stat_activity` connection counts
- Monitor `checkpoints` table row count — pruning job must be confirmed working

**Research flag:** Docker multi-stage build for Bun is well-documented. No additional research needed.

---

### Phase Ordering Rationale

- **Dependencies are strict:** `shared` → `database` → domain packages → `core` → apps. No phase can be usefully built without the previous being stable.
- **Phase 1 locks the one-way doors:** embedding dimension, state schema conventions, connection pool architecture, TypeScript alias resolution, and LangChain version pinning. All are cheap to do correctly the first time and expensive to change after.
- **Phase 2 builds in parallel within the phase:** `memory`, `embeddings`, `ai`, and `transport` are independent of each other and can be developed concurrently once `database` and `shared` exist.
- **Phase 3 is the integration test for Phase 2:** if the `BrainRunner` cannot wire all packages cleanly, the package boundaries defined in Phase 2 need adjustment. This is cheaper to discover here than after apps are built.
- **Phase 4 validates the entire stack under production conditions:** container restart, multi-tenant load, and checkpoint growth are all tested before any real Brain exists.

### Research Flags

**Needs validation during implementation:**
- `amqplib-bun` Bun stream compatibility (Phase 2 transport) — open GitHub issues exist; may need to fall back to PG `LISTEN/NOTIFY`
- LangSmith `AsyncLocalStorage` propagation on Bun (Phase 1 observability) — Bun's `node:async_hooks` has gaps; must be tested before relying on it
- `bun:sql` vs `postgres.js` driver (Phase 1 database) — research confirms the stuck-connection bug; use `postgres.js` from the start

**Standard patterns (skip research-phase):**
- LangGraph subgraph-as-node pattern (Phase 2/3) — well-documented, high confidence
- Drizzle ORM + pgvector integration (Phase 1/2) — official docs, high confidence
- Hono + Bun HTTP (Phase 2/3 transport) — well-documented, official support
- Docker multi-stage Bun builds (Phase 4) — official `oven/bun:1` image, no surprises
- Turborepo + pnpm workspaces (Phase 1) — well-documented, stable tooling

---

## Open Questions Requiring Decisions Before Planning

These are not gaps in research confidence — they are decisions the team must make explicitly because they affect multiple downstream phases:

1. **Embedding provider and dimension:** Must choose before writing any schema migration. Recommendation: `text-embedding-3-small` at 1536 dimensions (OpenAI, well-supported by LangGraph). If a lighter model is needed, `all-MiniLM-L6-v2` at 384 dims is the alternative. This is irreversible without re-embedding all data.

2. **RabbitMQ in v1 vs PostgreSQL LISTEN/NOTIFY:** Research shows `amqplib-bun` has open Bun stream compatibility issues. Recommendation: ship v1 with Webhook + PG `LISTEN/NOTIFY` as the async transport, add RabbitMQ in v2 once Bun's stream compatibility matures. Transport interface remains identical — the swap is a 1-file change.

3. **LangSmith vs self-hosted observability:** LangSmith requires an API key and network access. For air-gapped deployments, OpenTelemetry + Jaeger/Grafana Tempo is the fallback but requires manual instrumentation. Decide before building observability package.

4. **Initial Brain for Phase 4 validation:** `brain-echo` (simple echo Brain) vs `brain-sdr-minimal` (scaffolded SDR Brain with sub-agent pattern but no real prompts). The SDR-minimal approach validates the sub-agent pattern earlier at the cost of more Phase 4 complexity.

5. **pnpm as package manager:** Research recommends `pnpm` over `bun install` for workspace management due to a January 2026 performance regression. Team alignment needed: the monorepo uses `pnpm install` but `bun run` / `bun test` — a split tooling model.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official docs and npm releases (June 2026). Version numbers confirmed. `amqplib-bun` is the only MEDIUM item due to open Bun issues. |
| Features | HIGH | Cross-validated against LangGraph, CrewAI, AutoGen, and production guides. Table stakes are consistent across all frameworks. |
| Architecture | HIGH | LangGraph TypeScript docs are authoritative. Monorepo pattern validated against multiple production examples. Data flow derived directly from official patterns. |
| Pitfalls | HIGH | All critical pitfalls verified against GitHub issues, official docs, or multiple independent production reports — not speculation. |

**Overall confidence: HIGH**

### Gaps to Address During Implementation

- **`amqplib-bun` actual compatibility:** Research confirms issues exist but fork status may have improved. Test Bun 1.x + `amqplib-bun` explicitly on first use. Have PG `LISTEN/NOTIFY` as a ready fallback.
- **LangSmith on Bun:** `AsyncLocalStorage` gaps in Bun's `node:async_hooks` could break LangSmith trace propagation. Validate with a minimal LangGraph graph + LangSmith in Bun before building observability into core.
- **Drizzle v1.0 GA timeline:** Currently at v1.0-rc.4. If GA ships during the build, evaluate upgrade path. Pin to `0.45.x` until then.

---

## Sources

### Primary (HIGH confidence)
- `@langchain/langgraph` npm v1.3.7 — https://www.npmjs.com/package/@langchain/langgraph
- `@langchain/langgraph-checkpoint-postgres` v1.0.1 — https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres
- LangGraph TypeScript multi-agent guide — https://langgraphjs.guide/multi-agent/
- LangGraph TypeScript persistence guide — https://langgraphjs.guide/persistence/
- LangGraph hierarchical agents — https://langchain-ai.github.io/langgraph/tutorials/multi_agent/hierarchical_agent_teams/
- Hono v4.12.16 + Bun — https://hono.dev/docs/getting-started/bun
- Drizzle ORM pgvector guide — https://orm.drizzle.team/docs/guides/vector-similarity-search
- Drizzle ORM Bun SQL — https://orm.drizzle.team/docs/connect-bun-sql
- pgvector-node v0.3.0 Bun support — https://github.com/pgvector/pgvector-node
- Bun test runner — https://bun.com/docs/test
- Bun workspace configuration — https://bun.com/docs/guides/install/workspaces

### Secondary (MEDIUM confidence)
- amqplib Bun incompatibility (open issue) — https://github.com/oven-sh/bun/issues/5627
- amqplib-bun fork — https://socket.dev/npm/package/amqplib-bun
- Bun workspace performance regression — https://github.com/oven-sh/bun/issues/25799
- Bun `bun:sql` stuck-connection bug — https://www.pkgpulse.com/guides/bun-sql-vs-postgres-js-vs-drizzle-postgres-stack-2026
- LangGraph checkpoint unbounded growth — https://github.com/langchain-ai/langgraphjs/issues/1138
- LangGraph state serialization — https://markaicode.com/errors/langgraph-json-parse-error-fix/
- PGVector dimension mismatch (June 2026) — https://dbadataverse.com/tech/postgresql/2026/05/pgvector-gotchas-dimension-mismatch-casting-errors-and-alter-table-solved-2026
- Mastra vs LangGraph comparison 2026 — https://particula.tech/blog/mastra-vs-langgraph-vs-vercel-ai-sdk-typescript-agents
- Turborepo structuring guide — https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository
- Multi-tenant connection pooling — https://oneuptime.com/blog/post/2026-01-27-nodejs-multi-tenancy/view

### Tertiary (referenced, lower weight)
- LangSmith TypeScript tracing — https://docs.smith.langchain.com/tracing/integrations/typescript
- AI agent memory architecture (2026) — https://tacnode.io/post/ai-agent-memory-architecture-explained
- Multi-tenant AI agent architecture — https://fast.io/resources/ai-agent-multi-tenant-architecture/
- IVFFlat vs HNSW in pgvector — https://dev.to/philip_mcclarence_2ef9475/ivfflat-vs-hnsw-in-pgvector-which-index-should-you-use-305p

---
*Research completed: 2026-06-11*
*Ready for roadmap: yes*
