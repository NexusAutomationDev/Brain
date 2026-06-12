# Roadmap: Brain Core

## Overview

Brain Core is built in four phases that follow the hard dependency chain of the monorepo: foundation and database roots first, then domain packages in parallel, then the Brain SDK integration layer that wires them together, and finally a validation Brain that exercises every package end-to-end inside a Docker container. Each phase produces a verifiable capability that the next phase depends on. v1 ends with a working, Docker-packaged validation Brain — not a production Brain (SDR, Suporte, etc.), which are v2.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Monorepo scaffold, database layer, structured logging, and health check endpoint
- [ ] **Phase 2: Domain Packages** - Memory, embeddings, AI/LangGraph, transport, and Langfuse observability
- [ ] **Phase 3: Brain SDK** - IBrain interface, BrainRunner, ToolsRegistry, and DB-backed prompt loading
- [ ] **Phase 4: Validation Brain** - Echo Brain app that exercises every package, Docker multi-stage packaging, and integration tests

## Phase Details

### Phase 1: Foundation
**Goal**: The monorepo compiles, tests run in CI, the database layer is operational with multi-tenant connection pooling, and structured logging plus a health check endpoint are available to all packages
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-04, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. `pnpm build` succeeds across all packages from a clean install with zero TypeScript errors
  2. `pnpm test` runs the full suite via Turborepo and exits 0 in CI
  3. A database migration applied via `drizzle-kit migrate` creates all tables (`users`, `memories`, `agent_state`, `embeddings`) with the PGVector column sized by `EMBEDDING_DIMENSIONS` env
  4. Switching `DATABASE_NAME` env between two values routes queries to two isolated databases without cross-contamination, and the connection pool holds at most 20 tenants with LRU eviction
  5. Any package can import the pino logger and emit a structured JSON log line; `GET /health` returns `{ status: "ok", db: "connected", transport: "webhook" }`
**Plans**: 7 plans (5 original + 2 gap closure)

Plans:
- [x] 01-00-PLAN.md — Wave 0: Test file scaffolds for Nyquist compliance (DB and observability test stubs)
- [x] 01-01-PLAN.md — Monorepo scaffold with pnpm workspaces, Turborepo, shared TypeScript config, and packages/shared foundation
- [x] 01-02-PLAN.md — Database package scaffold with Drizzle schema and PGVector configuration
- [x] 01-02b-PLAN.md — Multi-tenant connection pooling (LRU eviction), migration script, and database package exports
- [x] 01-03-PLAN.md — Observability package with structured logging (Pino) and health check utilities
- [x] 01-04-PLAN.md — Gap closure: Fix observability tsconfig build failure, generate database migration SQL files, commit pnpm-lock.yaml
- [x] 01-05-PLAN.md — Gap closure: Create GET /health HTTP endpoint with Hono in packages/observability

### Phase 2: Domain Packages
**Goal**: The memory, embeddings, AI, and transport packages are individually functional and tested — all four can be imported by `packages/core` in the next phase
**Depends on**: Phase 1
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, AI-01, AI-02, AI-03, AI-04, AI-05, TRANS-01, TRANS-02, TRANS-03, TRANS-04, OBS-03
**Success Criteria** (what must be TRUE):
  1. A LangGraph graph using `PostgresSaver` as its checkpointer persists state across two separate invocations (simulated container restart between calls)
  2. `MemoryManager` reads a stored user profile row (long-term), retrieves the last checkpoint (short-term), and performs a similarity search returning the top-3 nearest embeddings (semantic) — all three layers exercised in a single test
  3. A Webhook transport handler receives an HTTP POST, extracts the `BrainEvent`, deduplicates a replay of the same `X-Request-Id`, and returns 200 once and 409 on the duplicate
  4. Langfuse traces appear in the Langfuse dashboard when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` env vars are set and a graph executes
  5. `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` env vars configure the embedding provider and vector column size without any hardcoded values in package source
**Plans**: 10 plans (8 original + 2 gap closure)

Plans:
- [x] 02-00-PLAN.md — Wave 0: Test DB setup (brain_test) and Nyquist test stubs for all domain packages
- [x] 02-02-PLAN.md — Wave 2: AI core (BrainStateAnnotation, createCheckpointer with PostgresSaver, subgraph pattern)
- [x] 02-03-PLAN.md — Wave 3: AI factories (createLLM 4-provider, createEmbeddings env-driven, barrel exports)
- [x] 02-04-PLAN.md — Wave 2: Transport (ITransport, WebhookTransport, BrainEvent zod, DedupCache, factory)
- [x] 02-05-PLAN.md — Wave 2: Memory layers (long-term readProfile/writeProfile, semantic upsertEmbedding/searchSimilar)
- [x] 02-06-PLAN.md — Wave 3: Memory completion (short-term PostgresSaver delegation, MemoryManager 3-layer composition)
- [x] 02-07-PLAN.md — Wave 4: Observability (createTracingCallbacks, Langfuse conditional integration)
- [ ] 02-08-PLAN.md — Gap closure Wave 5: Add missing direct deps to packages/memory/package.json (drizzle-orm, postgres, @langchain/langgraph-checkpoint-postgres)
- [ ] 02-09-PLAN.md — Gap closure Wave 5: Fix mock.module collision in AI tests + add test:integration script for PostgresSaver SC-1

### Phase 3: Brain SDK
**Goal**: `packages/core` exposes a stable `IBrain` contract, a `BrainRunner` that wires all domain packages, and a `ToolsRegistry` — ready for Brain implementations to be registered and executed
**Depends on**: Phase 2
**Requirements**: SDK-01, SDK-02, SDK-03, SDK-04
**Success Criteria** (what must be TRUE):
  1. A minimal Brain object implementing `IBrain` (with `id`, `promptKeys[]`, `tools[]`, `buildGraph()`) can be registered in `BrainRegistry` and resolved by ID
  2. `BrainRunner.run(event)` receives a `BrainEvent`, hydrates memory, invokes the LangGraph graph, persists memory layers after the turn, and returns the response — with no `MemorySaver` present anywhere in the call path
  3. `ToolsRegistry` enables a tool for Brain type "echo" and disables it for Brain type "other"; a call from "other" gets an error, a call from "echo" succeeds
  4. All prompts used by `BrainRunner` are loaded from the `prompts` database table via `promptKeys` at startup; no prompt strings appear in package source code
**Plans**: TBD

### Phase 4: Validation Brain
**Goal**: A working `apps/brain-echo` Docker image exercises every package integration end-to-end, proving the SDK contract is correct and the distribution model works
**Depends on**: Phase 3
**Requirements**: INFRA-03
**Success Criteria** (what must be TRUE):
  1. `docker build` produces a valid image for `apps/brain-echo` using the multi-stage Bun Dockerfile and the image starts without errors
  2. An HTTP POST to the running container's webhook endpoint produces a response that traverses transport → BrainRunner → LangGraph → all three memory layers → response, confirmed by structured log output
  3. Stopping and restarting the container mid-conversation (after turn 1, before turn 2) produces a turn-2 response that references context from turn 1, proving `PostgresSaver` durable state works
  4. Running 10 simultaneous simulated tenants (10 different `DATABASE_NAME` values) keeps `pg_stat_activity` connection count below the LRU cap limit (max 20 pools × pool size)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/7 | Not started | - |
| 2. Domain Packages | 0/10 | Not started | - |
| 3. Brain SDK | 0/TBD | Not started | - |
| 4. Validation Brain | 0/TBD | Not started | - |
