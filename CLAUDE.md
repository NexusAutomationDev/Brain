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

### Scope (opcional)

O scope identifica a área afetada pela mudança — geralmente o nome do pacote, app ou módulo (`packages/database` → `database`, `apps/brain-sdr` → `brain-sdr`). Use kebab-case quando o nome for composto.

```bash
✨ feat(brain-sdr): add qualification sub-agent
🐛 fix(database): resolve connection timeout in pool
📝 docs(api): update endpoint examples
```

### Título: tamanho e modo

- A linha de descrição (após emoji + type + scope) deve ter no máximo **72 caracteres**, idealmente até **50**, para manter legibilidade em `git log --oneline` e em ferramentas de CI/CD.
- Escreva no **modo imperativo** (`add`, `fix`, `change` — não `added`, `fixes`, `changing`).
- **Não** termine o título com ponto final.

### Corpo da mensagem (body)

Use o corpo para explicar **o quê** mudou e **por quê** — não **como** (isso já está no diff). Separe do título por uma linha em branco. Use bullet points quando houver múltiplas mudanças relacionadas.

```bash
♻️ refactor(transport): simplify RabbitMQ reconnection logic

- Remove manual retry loop in favor of amqplib-bun's built-in backoff
- Reduces reconnection time from ~5s to ~1s under normal failure
```

### Breaking Changes

Para mudanças que quebram compatibilidade, adicione `!` após o type/scope e/ou um footer `BREAKING CHANGE:` explicando o impacto e a migração necessária. Quando houver `BREAKING CHANGE:` e/ou `!`, use **💥** como emoji do commit, substituindo o emoji do type. Breaking changes disparam um bump de versão MAJOR (semver).

```bash
💥 refactor(api)!: remove deprecated /v1/chats endpoint

BREAKING CHANGE: clients must migrate to /v2/chats. The /v1 endpoint
returned a flat array; /v2 returns a paginated object with `data` and `meta`.
```

### Idioma da mensagem de commit

O título (`<description>`) deve ser escrito em **inglês**, seguindo o histórico real do repositório (verificado via `git log`) e os exemplos deste guia — independente do idioma do código ou comentários ao redor. O corpo (body) pode usar português em commits internos/de processo (ex: `docs(phase-N)`), mas o título permanece em inglês para manter consistência e buscabilidade no `git log`.

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

### Organização de Testes

Todos os arquivos de teste devem ficar em uma pasta dedicada `__tests__/` dentro do pacote correspondente, nunca ao lado dos arquivos de implementação.

**Estrutura obrigatória:**
```
packages/<pacote>/src/
  __tests__/
    unit/          # testes unitários (sem I/O externo)
    integration/   # testes que tocam banco, fila ou rede
  <código de produção>
```

**Regras:**
- Arquivos de teste usam o sufixo `.test.ts`
- Nunca criar arquivos `*.test.ts` fora de `__tests__/`
- Arquivos de teste manual/exploratório (ex: `test-*.ts`) ficam em `/tmp` ou são removidos antes do commit — não ficam na raiz do repo ou dos pacotes

### Arquivos de Teste Manual

Arquivos de teste manual (scripts exploratórios, provas de conceito, sandboxes) ficam em `manual/` na raiz do repo.

**Estrutura:**
```
manual/
  <nome-descritivo>.ts    # ex: test-brain-runner.ts, pg-vector-poc.ts
```

**Regras:**
- Nunca criar arquivos de teste manual na raiz do repo ou dentro de pacotes
- `manual/` está no `.gitignore` — esses arquivos não são commitados
- Se o script virar algo útil de verdade, migra para `__tests__/integration/`

### Documentação

Toda documentação técnica fica em `docs/` na raiz do repo, organizada por categoria.

**Estrutura:**
```
docs/
  architecture/    # decisões de arquitetura, diagramas
  guides/          # guias de uso, onboarding, how-tos
  api/             # referência de API dos pacotes
  adr/             # Architecture Decision Records (ADR-NNNN-titulo.md)
```

**Regras:**
- Nunca criar arquivos `.md` de documentação na raiz do repo (exceto `README.md`, `CLAUDE.md`, `CHANGELOG.md`)
- ADRs seguem o padrão `ADR-0001-titulo-kebab-case.md`
- Documentação de fase/planejamento fica em `.planning/` (gerenciado pelo GSD)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

### Modelo de Deployment por Cliente

Cada cliente recebe **1 imagem Docker** do Brain contratado (ex: Brain SDR). O cliente pode subir **múltiplas instâncias** dessa imagem — por redundância ou volume de atendimento.

```
Cliente X
├── brain-sdr (instância 1)  ─┐
├── brain-sdr (instância 2)  ─┼──► PostgreSQL (banco_cliente_x)
└── brain-sdr (instância 3)  ─┘
```

**Regras:**
- **1 banco por cliente** — isolamento via `DATABASE_NAME` ENV + TenantPoolManager
- **N instâncias do mesmo Brain** — todas apontam para o mesmo banco do cliente
- **Auto-migrate na inicialização** — cada instância roda `runMigrations()` ao subir; `pg_advisory_lock` garante que apenas uma migra por vez (as demais aguardam)
- **`unique_id` do lead = `IDLead` do payload** — a integração (WhatsApp/CRM via webhook ou RabbitMQ) envia o `IDLead`, que é armazenado como `leads.unique_id` e usado como `thread_id` no PostgresSaver (histórico de conversa por lead)

### Ciclo de Vida de um Brain

```
startup
  └── BrainRunner.init()
        ├── runMigrations(sql, MIGRATIONS_FOLDER)  ← advisory lock aqui
        │     └── CREATE EXTENSION vector + aplica migrations pendentes
        └── brain.init()  ← Brain inicializa prompts, tools, etc.

mensagem recebida (webhook ou RabbitMQ)
  └── BrainRunner.run(event)
        ├── LeadService.upsert(numero, IDLead, nome)  ← cria lead se primeiro contato
        ├── verifica ia_ativada  ← ignora silenciosamente se false
        └── LangGraph (thread_id = lead.unique_id)  ← recupera histórico via PostgresSaver
```

### Como Criar um Novo Brain

Novo Brain = novo app em `apps/brain-{tipo}/`. **Checklist obrigatório** — todo Brain entrega todos esses artefatos:

**Estrutura mínima:**
```
apps/brain-{tipo}/
  src/
    index.ts          # entry point — BrainRunner.start()
    brain.ts          # implementação IBrain
    graph.ts          # buildGraph() com nós LangGraph
    prompts/          # prompts carregados do banco (sem hardcode)
    tools/            # tools específicas do Brain (se houver)
  migrations/
    meta/
      _journal.json   # obrigatório para runMigrations()
    0001_init.sql     # schema inicial do Brain
  Dockerfile          # imagem independente (multi-stage)
  .env.example        # ENVs necessárias documentadas
  package.json        # workspace entry + scripts
```

**Dockerfile obrigatório** (todo Brain tem sua própria imagem):
```dockerfile
FROM node:22-slim AS builder
# ... build steps
FROM oven/bun:1 AS runner
# ... runtime
```

**ENVs mínimas obrigatórias** (documentar em `.env.example`):
- `DATABASE_URL`, `DATABASE_NAME` — banco do cliente
- `TRANSPORT` — `webhook` ou `rabbitmq`
- `MIGRATIONS_FOLDER` — caminho para `migrations/`
- `API_KEY` — chave do provider LLM
- `MODEL` — modelo LLM a usar

**Código obrigatório:**
1. `IBrain` implementado: `init()`, `run()`, `getPrompts()`, `getTools()`
2. `buildGraph()` com `BrainStateAnnotation` + nós `llm` e `tools`
3. `BrainRunner.start()` como entry point em `index.ts`
4. Brain registrado no `ToolsRegistry` com seu tipo
5. Migration inicial no `_journal.json`

**A partir do v1.5 — adicional obrigatório:**
- `IEmbeddingProvider` configurado via ENV (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`)
- Tools via MCP dinâmico (não hardcoded em `buildGraph()`) quando aplicável

O SDK (`packages/core`) cuida de todo o resto: lifecycle, migrations, transport, LangGraph, PostgresSaver.

### Onde Colocar Código Novo — packages/ vs apps/

O projeto é multi-Brain por design. Antes de criar qualquer coisa, perguntar: **"outro Brain poderia usar isso?"**

- **`packages/`** → código reutilizável por qualquer Brain (SDK, core, transport, utils, serviços genéricos)
- **`apps/brain-{tipo}/`** → apenas o que for **explicitamente exclusivo** de um único tipo de Brain (prompts, tools específicas, fluxos particulares)

Nunca colocar em `apps/` algo que outro Brain poderia aproveitar — isso vai contra o propósito da arquitetura compartilhada.
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
