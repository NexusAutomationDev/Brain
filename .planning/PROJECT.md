# Brain Core

## What This Is

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

O primeiro Brain real (SDR) foi entregue no v1.1 — atende leads no WhatsApp com histórico de conversa persistente, gate ia_ativada, sub-agente de qualificação e zero prompts hardcoded.

## Core Value

Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## Current State: Phase 17 complete — token usage exposure deployed (API REST + RabbitMQ log)

Brain Core v1.2 entregou o contrato completo de saída estruturada e tool contracts para todos os Brains. v1.3 foca em conectar Brains a ferramentas externas via MCP e deixar o LLM controlar o formato de resposta dinamicamente. Phase 14 complete: `prepare: false` aplicado em qualifier.ts — sub-agente de qualificação compatível com PgBouncer transaction mode.

## Current Milestone: v1.3 MCP Integration + Dynamic responseMode

**Goal:** Conectar Brains a ferramentas externas via MCP e deixar o LLM controlar o formato de resposta dinamicamente via structured output multi-provider.

**Target features:**
- TD-01 fix: `qualifier.ts` com `prepare: false` (risco de falha com PgBouncer em produção)
- MCP Integration: Brain conecta a servidor MCP externo (n8n) via ENV (`MCP_URL`, `MCP_TOOLS`), registra tools no startup como LangGraph tools normais
- responseMode dinâmico: LLM decide text/audio/image como parte do BrainOutput via `.withStructuredOutput()` — multi-provider (OpenAI + Anthropic)

## Requirements

### Validated

**v1.0 — MVP**

- ✓ Monorepo estruturado com `packages/` (shared, database, observability) — v1.0
- ✓ Schema PostgreSQL + PGVector (users, memories, agent_state, embeddings) — v1.0
- ✓ Multi-tenancy: 1 banco por cliente, seleção via `DATABASE_NAME` env (TenantPoolManager, LRU max 20) — v1.0
- ✓ Observabilidade básica (health check GET /health, logging estruturado com Pino) — v1.0
- ✓ `apps/` directory com Brain packages — v1.0
- ✓ Brain SDK: IBrain interface + BrainRunner lifecycle (init → run) + ToolsRegistry — v1.0
- ✓ Transport layer (Webhook): POST /api/v1/webhook traversa BrainRunner → LangGraph → resposta — v1.0
- ✓ Tools Registry: registerBrainType + enableTool por tipo de Brain — v1.0
- ✓ Docker: multi-stage Dockerfile (node:22-slim builder + oven/bun:1 runner), imagem por Brain — v1.0
- ✓ PostgresSaver: estado LangGraph persistido no PostgreSQL, dura container restart — v1.0

**v1.1 — Brain SDR + Infraestrutura Produção**

- ✓ Transport layer (RabbitMQ): seleção via `TRANSPORT=rabbitmq` env com campos padronizados (Name, Message, Numero, IDLead) — v1.1
- ✓ Schema: tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) com advisory lock em runMigrations() — v1.1
- ✓ Auto-migrate na inicialização do Brain (verificar/criar tabelas via ENV MIGRATIONS_FOLDER) — v1.1
- ✓ Fluxo: cadastro automático de lead na primeira mensagem + verificação `ia_ativada` — v1.1
- ✓ Histórico de conversas vinculado ao lead (thread_id = lead.uniqueId, recuperação via PostgresSaver) — v1.1
- ✓ Correção WebhookTransport.start() com runner injection (GAP-1) — v1.1
- ✓ Webhook: campos de entrada padronizados (Name, Message, Numero, IDLead) — v1.1
- ✓ Lint pipeline ativo em todos os 7 pacotes (turbo run lint passa 7/7) — v1.1
- ✓ Multi-tenant: TenantPoolManager ativo em produção no Brain SDR — v1.1
- ✓ Brain SDR: primeiro Brain real com fluxo de atendimento, qualificação e sub-agente — v1.1

**v1.2 — Output Parser + Tool Contracts**

- ✓ Output Parser SDK: `BrainOutput` type (fullResponse + responseMode obrigatórios) + `BrainOutputSchema` Zod com validação condicional — v1.2
- ✓ BrainRunner.run() valida saída do grafo e lança `BrainOutputValidationError` se null ou schema inválido — v1.2
- ✓ Tool Contracts SDK: `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` disponíveis no core — v1.2
- ✓ `BRAIN_TOOLS` ENV como whitelist CSV para `enableTool()` — controle de tools em runtime — v1.2
- ✓ Brain SDR migrado para contrato v1.2: BrainOutput estruturado, 3 tools no grafo, webhook sem campo `reply` — v1.2
- ✓ PgBouncer compatibility: `prepare: false` em TenantPoolManager, row-lock transacional em migrate, CR-01 fix em qualifier.ts — v1.2

### Active

**v1.3 — MCP Integration + Dynamic responseMode**

- [ ] MCP Integration: Brain conecta a servidor MCP externo via ENV (`MCP_URL`, `MCP_TOOLS`) e usa tools externas no LangGraph
- [ ] responseMode dinâmico: LLM decide `text/audio/image` via `.withStructuredOutput()` — multi-provider (OpenAI + Anthropic)
- [ ] TD-01 fix: `qualifier.ts` com `prepare: false` — blocker de produção com PgBouncer

**Backlog (pós v1.3)**

- [ ] Arquitetura de memória semântica (embeddings + RAG): busca por similaridade em produção
- [ ] Outros Brains: Suporte, Customer Success
- [ ] Sub-agente de qualificação avançada com SPIN/BANT completo
- [ ] Brain SDR publicando respostas de volta ao RabbitMQ (canal de resposta async)
- [ ] Resolver TD-03: `BRAIN_TOOLS` whitelist não cobre tools bound diretamente em buildGraph()

### Out of Scope

- Brain SDR com sub-agente de qualificação avançada (SPIN/BANT completo) — simplificado para v1.1; deferido para próximo milestone
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar
- fullpp com regra de negócio — futuro quando necessário
- Outros Brains específicos (Suporte, CS, Cobrança, RH) — pós v1.2
- `BRAIN_TOOLS_DISABLED` (lista de exclusão) — whitelist é suficiente por ora

## Context

**v1.2 (shipped 2026-06-15):** 4 fases (10-13), 11 planos, 122 commits, 163 arquivos alterados (+13.153 linhas), 2 dias de desenvolvimento. Contrato de saída estruturado entregue em todos os Brains; PgBouncer-compatible desde Phase 13.

**v1.1 (shipped 2026-06-14):** 5 fases (5-9), 12 planos, ~124 commits, 2 dias.

**v1.0 (shipped 2026-06-13):** ~7.094 linhas TypeScript, 4 fases (1-4), 28 planos, 234 commits, 23 dias.

Stack validado: Bun + Hono + Drizzle (postgres.js driver) + LangGraph + PostgresSaver + pgvector + Pino + Langfuse.

O Brain SDR tem uma arquitetura com sub-agente de qualificação stateless: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar. O sub-agente lê o histórico via PostgresSaver.getTuple() e retorna {qualificado, motivo, proximo_passo}. Toda comunicação de transport é via webhook (TRANSPORT=webhook) ou RabbitMQ (TRANSPORT=rabbitmq), selecionável via ENV. Desde v1.2, toda resposta é `BrainOutput` estruturado.

Brains planejados para o futuro: Suporte, Customer Success, Cobrança, RH, Jurídico, E-commerce, Agendamento.

**Tech debt acumulado (carry-over):**
- TD-01: `qualifier.ts` — `postgres()` sem `prepare: false` (targeted v1.3)
- TD-03: `BRAIN_TOOLS` whitelist inerte para tools bound diretamente em `buildGraph()`
- TD-04: `LeadService.setFullpp()` / `setIaAtivada()` sem callers de produção
- MEM-03: semantic write path (dead code) — createEmbeddings() nunca chamado
- OBS-02: transport status ausente no GET /health
- ~~handler.ts sem try/catch~~ — resolvido em quick task (try/catch existe em handler.ts:76-99)

## Constraints

- **Runtime**: Bun — performance e compatibilidade com Hono/Drizzle são critério de escolha de libs
- **Framework HTTP**: Hono — zero deps, performance superior com Bun, edge-compatible
- **ORM**: Drizzle — lightweight, TypeScript nativo, sem overhead de geração de client
- **AI**: LangGraph/LangChain — orquestração de agentes e fluxos
- **DB**: PostgreSQL + PGVector — memória de longo prazo, embeddings e RAG
- **Produto**: imagens Docker por Brain, clientes usam só a imagem contratada

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hono sobre Express | Melhor integração com Bun, zero deps, performance superior | ✓ Good — sem fricção em nenhuma das fases; sub-apps em brain-echo e brain-sdr triviais |
| Drizzle sobre Prisma | Lightweight, TypeScript nativo, sem geração de client, melhor com Bun | ✓ Good — único ajuste: usar `postgres.js` como driver (não `bun:sql`) por bug de conexão |
| Brain SDK no core desde v1 | Consistência no registro de Brains; evita refatoração quando criar o primeiro Brain | ✓ Good — brain-sdr integrou sem refatoração do SDK |
| 1 banco por cliente (inicial) | Isolamento simples agora; migrar para tenant_id quando escala demandar | ✓ Good — TenantPoolManager ativo em produção via DATABASE_NAME no brain-sdr |
| Tools Registry por tipo de Brain | Cada tipo define seu conjunto base de tools no código | ✓ Good — enableTool("sdr","qualify_lead") funcionou sem problemas |
| v1 = só infraestrutura core | Nenhum Brain específico no v1; garantir base sólida antes de implementar SDR | ✓ Good — decisão validada; base absorveu Brain SDR sem refatoração estrutural |
| postgres.js como driver Drizzle (não bun:sql) | Bug de conexão travada após constraint errors no bun:sql | ✓ Good — zero problemas com postgres.js durante todo o desenvolvimento |
| WebhookTransport runner injection via construtor (v1.1) | Fail-fast ConfigurationError se runner ausente | ✓ Good — GAP-1 resolvido; createTransport(runner) é API idiomática agora |
| rabbitmq-client@5.0.8 (não amqplib-bun) | Zero deps, Bun-compatible, auto-reconnect built-in; amqplib-bun tem bugs com large-message | ✓ Good — testes passaram, DLQ implementada sem dependência de configuração de broker |
| Sub-agente de qualificação stateless (sem checkpointer) | Lê histórico via PostgresSaver.getTuple() mas não persiste estado próprio | ✓ Good — evita acumulação de checkpoints do sub-agente; fallback gracioso em todos os pontos de falha |
| Drizzle _journal.json para migrations (GAP-1 v1.1) | Drizzle exige entrada no journal para executar SQL — 0005 foi adicionado pós-audit | ✓ Fixed — migrate() agora aplica seed de prompts SDR na inicialização |
| BrainOutput em shared, BrainOutputSchema em core (v1.2) | Evitar ciclo de dependência ai→core; type sem Zod em shared, schema Zod somente em core | ✓ Good — separação funcionou em todas as fases; transport usa duck typing IBrainRunnerLike |
| Tools padrão como factories com closure sobre sql (v1.2) | Mesmo padrão do boundQualifyTool — factory recebe sql e retorna StructuredTool | ✓ Good — pause_session e finish_conversation funcionando; thread_id vem de configurable, nunca do LLM |
| BRAIN_TOOLS como whitelist CSV via ENV (v1.2) | Controle de tools em runtime sem recompilação — enableTool() silenciosamente ignora tools fora da whitelist | ⚠ Revisit — whitelist não cobre tools bound diretamente em buildGraph() (TD-03); cobertura parcial |
| row-lock via _schema_lock (v1.2, substitui pg_advisory_lock) | pg_advisory_lock não funciona sob PgBouncer (connection-level lock perdido na devolução do pool) | ✓ Good — row-lock transacional funciona em qualquer pooler; DDL idempotente fora de transação |
| rabbitmq-client (não amqplib-bun) mantido em v1.2 | Sem mudança de decisão — zero deps, Bun-compatible, auto-reconnect built-in | ✓ Good — RabbitMQ consumer fire-and-forget por design; TD-05 documentado mas não é bug |

## Evolution

Este documento evolui nas transições de fase e marcos de milestone.

**Após cada transição de fase** (via `/gsd-transition`):
1. Requirements invalidados? → Mover para Out of Scope com motivo
2. Requirements validados? → Mover para Validated com referência de fase
3. Novos requirements? → Adicionar em Active
4. Decisões a registrar? → Adicionar em Key Decisions
5. "What This Is" ainda preciso? → Atualizar se divergiu

**Após cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value check — ainda é a prioridade certa?
3. Auditoria em Out of Scope — motivos ainda válidos?
4. Atualizar Context com estado atual

---
*Last updated: 2026-06-16 — Phase 17 complete: token usage exposure (tokenUsage field in API response + RabbitMQ log)*
