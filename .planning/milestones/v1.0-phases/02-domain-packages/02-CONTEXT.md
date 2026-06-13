# Phase 2: Domain Packages - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 cria os packages de domínio que serão consumidos pelo Brain SDK na Phase 3: `packages/memory`, `packages/ai`, `packages/transport`. Cada package deve ser individualmente funcional e testado — importável por `packages/core` sem reescritas. A integração Langfuse (OBS-03) também vai aqui porque depende dos packages LangChain/LangGraph que chegam nesta fase.

</domain>

<decisions>
## Implementation Decisions

### Observability (OBS-03)
- **D-01:** Usar **Langfuse** (não LangSmith) — alinha com REQUIREMENTS.md OBS-03 e success criteria SC-4 ("Langfuse dashboard"). LangSmith tem blocker de AsyncLocalStorage no Bun (registrado em STATE.md).
- **D-02:** Integração via **LangChain `CallbackHandler`** — `new CallbackHandler()` passado como callback nas invocações do graph. Sem instrumentação manual nos nós. Ativado por env vars `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`. Se vars ausentes: tracing silenciosamente desativado (não falha startup).

### Transport / Webhook (TRANS-01 a TRANS-04)
- **D-03:** Idempotência do Webhook via **in-memory TTL cache** — `Map<requestId, timestamp>` com TTL de 5-10 min. Zero infra extra, O(1) lookup. Perde estado no restart (aceitável para v1 — success criteria SC-3 não exige durabilidade).
- **D-04:** Path do endpoint Webhook: **`/api/v1/webhook`** (versionado, sem configuração via env por ora).
- **D-05:** `ITransport` como interface abstrata — implementação Webhook separada do contrato. RabbitMQ fica para v2 (já previsto em deferred).

### LLM Provider (AI-05)
- **D-06:** Provider configurado **100% via env** — sem default hardcoded:
  - `LLM_PROVIDER=openai|anthropic|gemini|openrouter`
  - `LLM_MODEL=` (ex: `gpt-4o`, `claude-sonnet-4-6`, `gemini-2.0-flash`)
  - `EMBEDDING_MODEL=` — mantém nome existente de AI-04 e schema Phase 1 (não renomear)
  - `EMBEDDING_DIMENSIONS=` — já existente
- **D-07:** Factory `createLLM(options)` retorna `BaseChatModel` do LangChain. Sem `LLM_PROVIDER` definido → falha startup com `ConfigurationError`.
- **D-08:** Suporte inicial aos 4 providers: OpenAI, Anthropic, Gemini, OpenRouter (todos via LangChain adapters).

### Testes
- **D-09:** Testes unitários usam **mock completo via `bun test` `mock.module()`** — LLM e embedding provider mockados, deterministicos, zero custo/latência.
- **D-10:** Testes de integração do `PostgresSaver` (success criteria SC-1) rodam contra **PostgreSQL real** via `TEST_DATABASE_URL`. AI-01 proíbe `MemorySaver` fora de testes unitários — essa restrição se mantém.
- **D-11:** Testes de embedding com PG real usam **FakeEmbeddings** (vetores determinísticos via hash) — testa a pipeline (DB, HNSW index, cosine search) sem chamar API externa.

### Carregado da Phase 1
- **D-01 (P1):** Packages organizados por domínio — `packages/memory`, `packages/ai`, `packages/transport` seguem o mesmo padrão.
- **D-03 (P1):** Path aliases `@brain-pkg/*` — novos packages seguem o mesmo namespace.
- **D-06/D-08 (P1):** Migrações forward-only, container falha no startup se migração falhar.

### Claude's Discretion
- TTL exato do in-memory dedup cache (sugestão: 10 minutos).
- Estrutura interna do `MemoryManager` (composição vs herança para as 3 camadas).
- Como expor o Langfuse `CallbackHandler` para os consumers (singleton ou factory por request).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Architecture
- `.planning/REQUIREMENTS.md` — Requirements MEM-01 a MEM-04, AI-01 a AI-05, TRANS-01 a TRANS-04, OBS-03
- `.planning/PROJECT.md` — Constraints (Bun, Hono, Drizzle, LangGraph), Core Value
- `CLAUDE.md` — Stack decisions, critical risks (amqplib-bun, bun:sql bug, pnpm over bun workspaces)
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria SC-1 a SC-5

### Phase 1 Context (padrões a seguir)
- `.planning/phases/01-foundation/01-CONTEXT.md` — Decisões de estrutura, naming, migrations, pool
- `.planning/research/STACK.md` — Technology stack decisions (se existir)

### Existing Code (padrões estabelecidos)
- `packages/database/src/schema/tables.ts` — Schema existente (users, memories, agent_state, embeddings)
- `packages/database/src/pool-manager.ts` — TenantPoolManager (padrão de pool multi-tenant)
- `packages/observability/src/logger.ts` — createLogger(LogContext) — padrão de logging
- `packages/shared/src/errors/index.ts` — BrainError, ConfigurationError — base de erros

### External Documentation
- Langfuse TypeScript SDK: https://langfuse.com/docs/integrations/langchain (callback handler integration)
- `@langchain/langgraph-checkpoint-postgres` v1.0.1: https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TenantPoolManager` (`packages/database`) — fornece `Sql` (postgres.js) por tenant; `packages/memory` e `packages/ai` consumirão isso
- `createLogger(LogContext)` (`packages/observability`) — todos os novos packages devem usar para logging estruturado
- `BrainError` / `ConfigurationError` (`packages/shared/errors`) — base para erros dos novos packages
- Schema `memories`, `embeddings`, `agent_state` (`packages/database/schema/tables.ts`) — tabelas já existem, sem novas migrações necessárias para Phase 2 (exceto se dedup webhook precisar de tabela — decidido: não precisa)

### Established Patterns
- Barrel exports em `src/index.ts` — novos packages seguem mesmo padrão
- Testes em `src/*.test.ts` ao lado do arquivo — `bun test` pick up automático
- `@brain-pkg/*` aliases — adicionar no `tsconfig.base.json` para os 3 novos packages
- `postgres.js` como driver Drizzle (não `bun:sql`) — crítico, já decidido em Phase 1

### Integration Points
- `packages/memory` → usa `TenantPoolManager` para obter `Sql`, `drizzle()` para queries
- `packages/ai` → usa `packages/database` para `PostgresSaver`, `packages/memory` para MemoryManager
- `packages/transport` → expõe Hono app (ou router); será montado no app container da Phase 4
- `packages/observability` → health check vai adicionar `transport: "webhook"` no response (D-15 da Phase 1 deferred)

</code_context>

<specifics>
## Specific Ideas

### Env Vars Confirmados para Phase 2
```
LLM_PROVIDER=openai|anthropic|gemini|openrouter
LLM_MODEL=<model-name>
EMBEDDING_MODEL=<embedding-model-name>          # existente do Phase 1
EMBEDDING_DIMENSIONS=<int>                       # existente do Phase 1
LANGFUSE_PUBLIC_KEY=<key>                        # OBS-03 — opcional, disable tracing se ausente
LANGFUSE_SECRET_KEY=<key>                        # OBS-03 — opcional
```

### Success Criteria Traceability
1. SC-1: LangGraph + PostgresSaver persiste entre 2 invocações → D-10 (PG real)
2. SC-2: MemoryManager exercita as 3 camadas em único test → D-09, D-11
3. SC-3: Webhook recebe POST, deduplica replay, retorna 200/409 → D-03, D-04
4. SC-4: Langfuse traces aparecem no dashboard → D-01, D-02
5. SC-5: EMBEDDING_MODEL e EMBEDDING_DIMENSIONS via env → D-06

### Packages a Criar
- `packages/memory` — MemoryManager (3 camadas: PostgresSaver, Drizzle memories, pgvector embeddings)
- `packages/ai` — LangGraph + PostgresSaver, state schema, LLM factory, embedding factory
- `packages/transport` — ITransport interface + WebhookTransport (Hono handler + dedup)

</specifics>

<deferred>
## Deferred Ideas

- RabbitMQ transport implementation → v2 (ITransport interface já prevista, só plugar)
- OpenTelemetry como alternativa self-hosted ao Langfuse → v2 (REQUIREMENTS.md v2)
- Checkpoint table pruning job → v2 (crescimento ilimitado da tabela `checkpoints`)
- Redis para dedup de idempotência → não no stack v1

</deferred>

---

*Phase: 02-domain-packages*
*Context gathered: 2026-06-11*
