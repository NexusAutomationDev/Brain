## Git Commit Guidelines

**MANDATORY**: All commits must follow the Conventional Commits specification with emojis.

### Commit Message Format

```
<emoji> <type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types with Emojis

| Emoji | Type | When to use |
|-------|------|-------------|
| ✨ | **feat** | A new feature |
| 🐛 | **fix** | A bug fix |
| 📝 | **docs** | Documentation only changes |
| 💄 | **style** | Code style/formatting (whitespace, semicolons, etc) |
| ♻️ | **refactor** | Code change that neither fixes a bug nor adds a feature |
| ⚡️ | **perf** | Performance improvements |
| ✅ | **test** | Adding or updating tests |
| 🔧 | **chore** | Changes to build process or auxiliary tools |
| 🏗️ | **build** | Changes that affect the build system or dependencies |
| 🤖 | **ci** | Changes to CI configuration files and scripts |
| ⏪️ | **revert** | Reverts a previous commit |
| 🔒️ | **security** | Security improvements or fixes |

### Examples

```bash
✨ feat: add endpoint to search chats by botIdentifier

🐛 fix(mongodb): resolve connection timeout in service

📝 docs: update API endpoint examples in README

♻️ refactor(database): simplify database iteration logic

⚡️ perf: optimize message query improving time by 30%

✅ test: add unit tests for authentication service

🔧 chore: configure lint-staged and husky for pre-commit

🏗️ build: adjust GitHub Actions workflow for production

🔒️ security: validate JWT tokens before processing requests
```

### Important Rules

**NEVER** include these lines in commits:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude <noreply@anthropic.com>
```

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Brain Core**

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

**Core Value:** Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

### Constraints

- **Runtime**: Bun — performance e compatibilidade com Hono/Drizzle são critério de escolha de libs
- **Framework HTTP**: Hono — zero deps, performance superior com Bun, edge-compatible
- **ORM**: Drizzle — lightweight, TypeScript nativo, sem overhead de geração de client
- **AI**: LangGraph/LangChain — orquestração de agentes e fluxos
- **DB**: PostgreSQL + PGVector — memória de longo prazo, embeddings e RAG
- **Produto**: imagens Docker por Brain, clientes usam só a imagem contratada
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Runtime & HTTP
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun | 1.x (latest) | JavaScript runtime + package manager | Faster cold starts, native TS execution, built-in test runner, native SQLite — chosen constraint, well-justified |
| Hono | 4.12.x | HTTP framework | Zero dependencies, ~14KB, first-class Bun support, edge-compatible, RPC for type-safe client contracts |
### Agent Orchestration
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@langchain/langgraph` | 1.3.7 | Agent graph orchestration | Explicit state machines, conditional routing, loop support, human-in-the-loop checkpoints, supervisor/swarm multi-agent patterns |
| `@langchain/core` | latest peer | LLM abstractions | Peer dep of langgraph; tool calling, message types, model adapters |
| `@langchain/langgraph-checkpoint-postgres` | 1.0.1 | Persistent checkpointing to PG | Durable agent state across restarts; uses PostgreSQL already in stack |
- The project requires **explicit stateful graph workflows** (qualificação sub-agent, multi-step SDR flow) — LangGraph's graph model maps directly to this
- The project is infrastructure-centric, not frontend-centric — Mastra's main advantage (Next.js/Vercel DX) doesn't apply here
- LangGraph's explicit node/edge model gives fine-grained control over agent state transitions, which matters for a SDK that others will extend
- `@langchain/langgraph-checkpoint-postgres` provides durable state persistence using the PostgreSQL already in the stack, no extra infrastructure
- Mastra's primary DX wins are for Vercel/Next.js deployments; this project ships Docker images
- Mastra wraps Inngest for durability — adds external service dependency; LangGraph checkpoint to PG is self-contained
- Mastra's ecosystem is younger — fewer answers when hitting edge cases with a novel Brain SDK abstraction
- The project already has LangGraph as a stated constraint; switching costs are high and benefits don't apply here
### Database & ORM
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | 16.x | Primary datastore | Vector support via pgvector, JSONB for flexible agent state, proven reliability |
| pgvector | 0.8.x | Vector similarity search | RAG and semantic memory; native PG extension avoids separate vector DB |
| `drizzle-orm` | 0.45.x (stable) | ORM + query builder | Lightweight (~7.4KB, 0 deps), TS-native, Bun SQL driver supported natively |
| `drizzle-kit` | latest | Migrations + schema push | CLI for schema management; minor issue with `bun sql` driver for `push` command (use `postgres.js` adapter for drizzle-kit) |
| `pgvector` (npm) | 0.3.0 | pgvector Node.js client | Explicit Bun SQL support documented; integrates with Drizzle ORM |
### Transport Layer
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Webhook (built-in) | — | Synchronous transport | Hono handler; zero deps; primary integration point for WhatsApp/CRM via ENV selection |
| `amqplib-bun` | 0.10.x | RabbitMQ async transport | Use this fork, NOT the vanilla `amqplib` |
- Connection failures in older Bun versions
- "Invalid frame" errors for large messages with Bun's stream implementation (issue #5627, still open)
- RabbitMQ 4.1.0+ requires amqplib >= 0.10.7
### Observability
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| LangSmith | SDK ^0.x | Agent trace visualization | First-class LangGraph integration; automatic trace nesting; no instrumentation code needed in nodes |
| `pino` | ^9.x | Structured logging | Bun-compatible, 5-7x faster than Winston, JSON output for log aggregation |
| `@opentelemetry/sdk-node` | ^0.x | OTEL spans | Optional for infrastructure spans (DB, HTTP); LangSmith exports to OTEL sinks |
### Testing
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `bun test` (built-in) | Bun 1.x | Unit + integration tests | Native Jest-compatible API, fastest execution (0.08s vs Vitest 0.9s cold start), no config |
| `@langchain/langgraph-checkpoint-validation` | latest | Checkpointer conformance | Official package to validate custom checkpoint store implementations |
- Bun test is Jest-compatible API — same `describe`, `it`, `expect`, `mock` syntax
- No config file needed; TypeScript supported natively
- 10x faster than Vitest cold starts in benchmarks
- Vitest + Bun has unresolved compatibility issues (module mocks, inline snapshots)
### Build & Packaging
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Bun workspaces | built-in | Monorepo package linking | Native workspace support, no Turborepo/Lerna needed for package linking |
| Docker (Bun base image) | `oven/bun:1` | Brain image packaging | Official Bun Docker image; minimal, distroless-compatible |
# Each Brain image extends this
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
## Installation
# Core runtime + framework
# AI orchestration
# Database
# Transport (RabbitMQ path)
# Observability
# Dev dependencies
## Critical Risks & Mitigations
| Risk | Severity | Mitigation |
|------|----------|------------|
| `amqplib` Bun incompatibility | HIGH | Use `amqplib-bun` fork; design transport interface for easy swap; consider PG LISTEN/NOTIFY for v1 |
| Drizzle v1.0 RC instability | MEDIUM | Pin to `0.45.x` stable; monitor v1.0 GA release |
| LangGraph.js TypeScript lag behind Python | LOW | Only affects cutting-edge features; core API (StateGraph, nodes, edges, checkpointers) is stable |
| `bun:sql` driver bug (stuck connection after constraint error) | MEDIUM | Use `postgres.js` as Drizzle driver instead of `bun:sql`; `postgres.js` is cross-runtime and has no known Bun issues |
| pgvector HNSW index tuning | LOW | Set `m=16, ef_construction=64` as defaults; increase for production based on vector count |
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
