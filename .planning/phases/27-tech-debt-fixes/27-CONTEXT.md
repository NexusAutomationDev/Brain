# Phase 27: Tech Debt Fixes - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Quitar três itens de tech debt isolados acumulados do v1.4: cobertura do BRAIN_TOOLS ENV para tools criadas em buildGraph(), teste de integração E2E do FupScheduler contra PostgreSQL real, e exposição do status do transport no GET /health.

Fixes são independentes entre si (sem inter-dependências). Nenhuma nova feature — apenas corrigir comportamentos incompletos já documentados como debt.

</domain>

<decisions>
## Implementation Decisions

### TECH-01: BRAIN_TOOLS whitelist cobrindo tools do buildGraph()

- **D-01:** `BrainBuildContext` ganha campo `enabledTools: Set<string> | null`. `null` = sem filtro (BRAIN_TOOLS não setado). Set com nomes = filtro ativo.
- **D-02:** BrainRunner popula `ctx.enabledTools` a partir do envWhitelist do ToolsRegistry antes de chamar `buildGraph()`.
- **D-03:** Brain é responsável por filtrar tools antes do `bindTools()`. Padrão: `[...tools].filter(t => !ctx.enabledTools || ctx.enabledTools.has(t.name))`.
- **D-04:** O filtro se aplica tanto às tools nativas (closures criadas em buildGraph) quanto às `ctx.mcpTools` injetadas pelo runner. BRAIN_TOOLS é whitelist global para o LLM.
- **D-05:** `IBrain.tools[]` (stubs de schema usados hoje para registro no ToolsRegistry) continua existindo — ToolsRegistry.enableTool() não é removido. O `enabledTools` Set é gerado a partir do envWhitelist, não do registry filtrado.

### TECH-02: Teste E2E do FupScheduler

- **D-06:** Teste de integração em `packages/core/src/__tests__/integration/fup-e2e.test.ts` (seguindo convenção de `__tests__/integration/`).
- **D-07:** LLM mockado — sem custo de API. O teste cobre FUP-02 (scheduler lê e escreve no banco real), não FUP-03 (geração de conteúdo por LLM).
- **D-08:** Teste cobre multi-step: criar lead elegível, rodar ticks do FupScheduler, verificar que fup_step avança, fup_next_at é atualizado, e após último step: `ia_ativada=false` + `fup_enabled=false` (FUP-05).
- **D-09:** Usar mesmo padrão dos testes de integração existentes (qualify.test.ts, rag-e2e.test.ts): PostgreSQL real via DATABASE_URL, runMigrations() no setup, limpeza via rollback ou DELETE no teardown.

### TECH-03: Transport status no GET /health

- **D-10:** `ITransport` em `packages/transport/src/interface.ts` ganha método `getStatus(): TransportStatus`.
- **D-11:** `TransportStatus` type: `{ type: 'webhook' | 'rabbitmq'; connected: boolean }`.
- **D-12:** `WebhookTransport.getStatus()` sempre retorna `{ type: 'webhook', connected: true }` — HTTP server não tem estado de conexão separado.
- **D-13:** `RabbitMQTransport.getStatus()` retorna `connected: true` quando conexão RabbitMQ está estabelecida, `false` quando em reconexão ou não iniciada.
- **D-14:** `createHealthApp()` em `packages/observability` aceita segundo parâmetro opcional `transport?: ITransport`. Quando ausente, campo transport omitido do response (backward compatible).
- **D-15:** `HealthCheckResult.checks` ganha `transport?: 'connected' | 'disconnected'`. Response body ganha `transport?: TransportStatus`.
- **D-16:** HTTP status quando transport desconectado mas DB ok → **503** (transport é falha crítica — Brain não processa mensagens).

### Claude's Discretion

- Nomenclatura exata do tipo `TransportStatus` e onde exportá-lo (packages/transport ou packages/shared).
- Estratégia de limpeza do banco no teardown do teste E2E (DELETE vs transaction rollback).
- Como `RabbitMQTransport` rastreia estado de conexão internamente (flag booleana vs verificar `this.rabbit` + estado da lib).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tech Debt Source
- `.planning/REQUIREMENTS.md` §Tech Debt (TECH-01, TECH-02, TECH-03) — critérios de aceitação oficiais
- `.planning/STATE.md` §Tech Debt — lista carry-over com contexto original de cada item

### TECH-01 — Arquivos afetados
- `packages/core/src/runner/runner.ts` — BrainRunner._compileGraph() onde ctx é montado e buildGraph() é chamado
- `packages/core/src/tools/registry.ts` — ToolsRegistry com envWhitelist já parseado
- `apps/brain-sdr/src/brain.ts` — buildGraph() que cria closures e chama bindTools() ignorando whitelist hoje

### TECH-02 — Arquivos de referência
- `packages/core/src/fup/fup-scheduler.ts` — FupScheduler a ser testado
- `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` — testes unitários existentes (ver cenários cobertos)
- `apps/brain-sdr/src/__tests__/integration/rag-e2e.test.ts` — padrão de integration test com PG real
- `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` — outro exemplo de integration test

### TECH-03 — Arquivos afetados
- `packages/transport/src/interface.ts` — ITransport a ser expandido
- `packages/transport/src/webhook/handler.ts` — WebhookTransport
- `packages/transport/src/rabbitmq/consumer.ts` — RabbitMQTransport
- `packages/observability/src/server.ts` — createHealthApp() a ser expandido
- `packages/observability/src/health.ts` — HealthCheckResult interface
- `apps/brain-sdr/src/server.ts` — monta createHealthApp(sql) — precisará passar transport

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ToolsRegistry.envWhitelist` (private) — já está parseado no construtor; precisará ser exposto (método getter ou passado direto ao ctx)
- `performHealthCheck(sql)` em `packages/observability/src/health.ts` — função a ser estendida para aceitar transport status opcional
- `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` — padrão de setup/teardown para integration tests no core

### Established Patterns
- `prepare: false` obrigatório em todas as conexões postgres.js (PgBouncer transaction mode)
- `bun:sql` tem bug de conexão após constraint errors — usar `postgres.js` driver
- Integration tests usam DATABASE_URL do ambiente; skippam com `describe.skip` se ausente
- Tools registry: `enableTool(brainType, toolName)` + `getTools(brainType, tools[])` — padrão whitelist já estabelecido

### Integration Points
- TECH-01: `BrainRunner._compileGraph()` monta ctx (~linha 513 em runner.ts) — adicionar `enabledTools` aqui
- TECH-03: `apps/brain-sdr/src/server.ts` monta `createHealthApp(sql)` — precisará passar `transport` como segundo arg

</code_context>

<specifics>
## Specific Ideas

- TECH-01: O `ctx.enabledTools` deve vir do `envWhitelist` do ToolsRegistry, não do registry filtrado (`getTools()` já filtra IBrain.tools[], que não inclui as closures do buildGraph)
- TECH-02: Multi-step FUP até ia_ativada=false cobre tanto FUP-02 quanto FUP-05 em um único teste — eficiente
- TECH-03: `createHealthApp(sql, transport?)` mantém backward compat — brain-echo não precisa ser alterado se não usar transport

</specifics>

<deferred>
## Deferred Ideas

Nenhuma ideia fora do escopo surgiu na discussão. Todos os tópicos discutidos são parte dos requisitos TECH-01/02/03.

</deferred>

---

*Phase: 27-tech-debt-fixes*
*Context gathered: 2026-06-29*
