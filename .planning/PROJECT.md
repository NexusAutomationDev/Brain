# Brain Core

## What This Is

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

O primeiro Brain real (SDR) foi entregue no v1.1 — atende leads no WhatsApp com histórico de conversa persistente, gate ia_ativada, sub-agente de qualificação e zero prompts hardcoded.

## Core Value

Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## Current Milestone: v1.2 Output Parser + Tool Contracts

**Goal:** Padronizar o contrato de saída dos Brains e o sistema de tools — tornando toda resposta estruturada e o conjunto de tools configurável via ENV.

**Target features:**
- Output Parser padrão (JSON schema com `fullResponse`, `responseMode`, `mediaType`/`mediaUrl` opcionais)
- Controle de tools via ENV (override do `enableTool()` em runtime)
- Tool padrão: Pausar sessão (`fullpp`: true → false)
- Tool padrão: Finalizar conversa (`ia_ativada` → false, `fullpp` → false)

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

### Active

- [ ] Arquitetura de memória semântica (embeddings + RAG): busca por similaridade em produção
- [ ] Outros Brains: Suporte, Customer Success — próximo milestone
- [ ] Sub-agente de qualificação avançada com SPIN/BANT completo — próximo milestone

### Out of Scope

- Brain SDR com sub-agente de qualificação avançada (SPIN/BANT completo) — simplificado para v1.1; SPIN/BANT é v1.2
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar
- fullpp com regra de negócio — futuro quando necessário
- Brain SDR publicando respostas de volta ao RabbitMQ — apenas consume em v1.1 (amqplib-bun large-message bug evitado via rabbitmq-client)
- Outros Brains específicos (Suporte, CS, Cobrança, RH) — pós v1.1

## Context

**Estado v1.2 (Phase 13 completa 2026-06-15):** PgBouncer compatibility entregue — `prepare: false` em TenantPoolManager e CLI de migrate.ts; `pg_advisory_lock` substituído por row-lock transacional via `_schema_lock`; `saver.end()` em `finally` corrige connection leak CR-01 em qualifier.ts; JSDoc documenta limitação de PostgresSaver com transaction mode. 11/11 must-haves verificados. PGB-01..05 satisfeitos.

**Estado v1.2 (Phase 12 completa 2026-06-15):** Brain SDR integrado ao contrato v1.2 — 3 tools bound no LangGraph (qualify_lead, pause_session, finish_conversation), nó llm seta `brainOutput`, standard tools registradas no ToolsRegistry, webhook retorna `{ fullResponse, responseMode }` (campo `reply` removido). 25/25 testes passando. PARSER-03 e TOOLS-STD-03 satisfeitos.

**Estado v1.2 (Phase 11 completa 2026-06-15):** Tool Contracts SDK entregue — `createPauseSessionTool(sql)` e `createFinishConversationTool(sql)` como factories tipadas; guard `BRAIN_TOOLS` em `enableTool()` (whitelist CSV via ENV); `BrainBuildContext` com `sql?: Sql`; `BrainRunner` injeta `sql: this.sql`; 22 testes verdes (7/7 truths verificadas). TOOLS-ENV-01/02 e TOOLS-STD-01/02 satisfeitos.

**Estado v1.2 (Phase 10 completa 2026-06-15):** Output Parser SDK entregue — contrato de saída estruturado `BrainOutput` com `fullResponse`, `responseMode` e validação Zod; BrainRunner retorna `BrainOutput | null`; 68 testes verdes (8/8 truths verificadas).

**Estado v1.1 (shipped 2026-06-14):** 2 Brains implementados (brain-echo, brain-sdr), ~9 pacotes no monorepo, 367 commits totais.

**v1.0 (shipped 2026-06-13):** ~7.094 linhas TypeScript, 8 pacotes, 234 commits, 23 dias de desenvolvimento.

Stack validado: Bun + Hono + Drizzle (postgres.js driver) + LangGraph + PostgresSaver + pgvector + Pino + Langfuse.

O Brain SDR tem uma arquitetura com sub-agente de qualificação: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar. O sub-agente lê o histórico via PostgresSaver.getTuple() e retorna {qualificado, motivo, proximo_passo}. Toda comunicação de transport é via webhook (TRANSPORT=webhook) ou RabbitMQ (TRANSPORT=rabbitmq), selecionável via ENV.

Brains planejados para o futuro: Suporte, Customer Success, Cobrança, RH, Jurídico, E-commerce, Agendamento.

**Tech debt v1.1 para v1.2:**
- MEM-03: semantic write path (dead code) — createEmbeddings() nunca chamado pelo BrainRunner
- OBS-02: transport status ausente no GET /health
- users table obsoleta — deprecar em v2
- handler.ts sem try/catch em runner.run() — unhandled errors → 500 genérico
- apps/brain-sdr sem lint script (brain-echo também)
- GAP-2: brain-sdr .env usa OPENAI_API_KEY em vez de API_KEY (dev-only)

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
*Last updated: 2026-06-15 after Phase 13 — PgBouncer compatibility: prepare:false + row-lock + CR-01 fix*
