# Brain Core — v1 Requirements

## v1 Requirements

### Infrastructure & Tooling

- [ ] **INFRA-01**: Monorepo estruturado com `apps/` e `packages/` usando pnpm workspaces + Turborepo
- [ ] **INFRA-02**: TypeScript shared config (`tsconfig.base.json`), ESLint config e path aliases configurados no monorepo
- [ ] **INFRA-03**: Docker multi-stage com Bun runtime para cada app
- [ ] **INFRA-04**: Scripts de desenvolvimento padronizados (`dev`, `build`, `test`, `lint`) via Turborepo pipeline

### Database Layer

- [ ] **DB-01**: Schema PostgreSQL com tabelas `users`, `memories`, `agent_state`, `embeddings` usando Drizzle ORM
- [ ] **DB-02**: Extensão PGVector instalada com coluna `vector(N)` configurável via `EMBEDDING_DIMENSIONS` env
- [ ] **DB-03**: Multi-tenancy via `DATABASE_NAME` env — 1 banco por cliente, selecionado na inicialização
- [ ] **DB-04**: Connection pool por tenant com LRU cache (evitar pool explosion com múltiplos tenants)
- [ ] **DB-05**: Migrations versionadas com Drizzle Kit (`drizzle-kit migrate`)
- [ ] **DB-06**: Driver `postgres.js` como adaptador Drizzle (não `bun:sql`)

### Memory Package

- [ ] **MEM-01**: Short-term memory gerenciada pelo LangGraph `PostgresSaver` (checkpoints de sessão)
- [ ] **MEM-02**: Long-term memory — leitura e escrita estruturada de perfil do usuário via Drizzle (tabela `memories`)
- [ ] **MEM-03**: Semantic memory — upsert de embeddings na tabela `embeddings` de forma assíncrona (fire-and-forget) após cada turno
- [ ] **MEM-04**: `MemoryManager` como abstração que encapsula as 3 camadas com interface unificada

### AI Package

- [ ] **AI-01**: LangGraph integration com `PostgresSaver` como único checkpointer (MemorySaver proibido fora de testes unitários)
- [ ] **AI-02**: Suporte a sub-agentes via subgraph pattern (parent Brain invoca child graph e recebe resultado)
- [ ] **AI-03**: State schema com campo `schema_version` e apenas JSON-safe primitives (sem Set, Map, Date, Buffer)
- [ ] **AI-04**: Embedding provider e dimensão configuráveis via env (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) — sem hardcode
- [ ] **AI-05**: Abstração de LLM provider (OpenAI, Gemini, outros compatíveis com LangChain)

### Transport Package

- [ ] **TRANS-01**: Interface `ITransport` abstrata desacoplada de implementação específica
- [ ] **TRANS-02**: Implementação Webhook com Hono — recebe mensagens via HTTP POST
- [ ] **TRANS-03**: Idempotência no Webhook via chave determinística (header `X-Request-Id` ou `conversationId + stepIndex`)
- [ ] **TRANS-04**: Seleção de transport via `TRANSPORT` env (`webhook` no v1)

### Brain SDK

- [ ] **SDK-01**: Interface `IBrain` com contrato mínimo: `id`, `promptKeys[]`, `tools[]`, `buildGraph()`
- [ ] **SDK-02**: `BrainRunner` — host que recebe um `IBrain` e gerencia wiring (memory, checkpointer, tools, transport)
- [ ] **SDK-03**: `ToolsRegistry` — registro de tools com enable/disable por tipo de Brain
- [ ] **SDK-04**: Todos os prompts armazenados no banco de dados (tabela referenciada por `promptKeys`) — sem prompts hardcoded em código

### Observability

- [ ] **OBS-01**: Logging estruturado em JSON (timestamps, nível, contexto do Brain, tenant)
- [ ] **OBS-02**: Health check endpoint (`GET /health`) retornando status do banco e do transport
- [ ] **OBS-03**: Langfuse integration via LangChain callbacks — ativado por env vars (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`)

---

## v2 Requirements (Deferred)

- RabbitMQ transport implementation (interface `ITransport` já está pronta, só plugar)
- Brain SDR implementation (`apps/brain-sdr` com sub-agente de qualificação)
- Brain Suporte implementation (`apps/brain-support`)
- Mecanismo de licenciamento via `LICENSE_KEY`
- Migração para `tenant_id` em tabelas (quando escala demandar)
- Brain management UI
- OpenTelemetry + Jaeger como alternativa self-hosted ao Langfuse
- Checkpoint table pruning job (crescimento ilimitado da tabela `checkpoints`)

---

## Out of Scope

- Brain implementations específicos (SDR, Suporte, CS) — v1 é só infraestrutura
- UI de gerenciamento — sem clientes ainda para justificar
- RBAC de tools por instância — por tipo de Brain é suficiente para v1
- Multi-LLM routing em tempo de execução — cada Brain tem um provider configurado
- Fine-tuning ou model training — fora do escopo do projeto

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 4 | Pending |
| INFRA-04 | Phase 1 | Pending |
| DB-01 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DB-03 | Phase 1 | Pending |
| DB-04 | Phase 1 | Pending |
| DB-05 | Phase 1 | Pending |
| DB-06 | Phase 1 | Pending |
| MEM-01 | Phase 2 | Pending |
| MEM-02 | Phase 2 | Pending |
| MEM-03 | Phase 2 | Pending |
| MEM-04 | Phase 2 | Pending |
| AI-01 | Phase 2 | Pending |
| AI-02 | Phase 2 | Pending |
| AI-03 | Phase 2 | Pending |
| AI-04 | Phase 2 | Pending |
| AI-05 | Phase 2 | Pending |
| TRANS-01 | Phase 2 | Pending |
| TRANS-02 | Phase 2 | Pending |
| TRANS-03 | Phase 2 | Pending |
| TRANS-04 | Phase 2 | Pending |
| OBS-01 | Phase 1 | Pending |
| OBS-02 | Phase 1 | Pending |
| OBS-03 | Phase 2 | Pending |
| SDK-01 | Phase 3 | Pending |
| SDK-02 | Phase 3 | Pending |
| SDK-03 | Phase 3 | Pending |
| SDK-04 | Phase 3 | Pending |
