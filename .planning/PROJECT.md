# Brain Core

## What This Is

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

## Core Value

Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## Requirements

### Validated

- [x] Monorepo estruturado com `packages/` (shared, database, observability) — Validated in Phase 1: foundation
- [x] Schema PostgreSQL + PGVector (users, memories, agent_state, embeddings) — Validated in Phase 1: foundation
- [x] Multi-tenancy: 1 banco por cliente, seleção via `DATABASE_NAME` env (TenantPoolManager, LRU max 20) — Validated in Phase 1: foundation
- [x] Observabilidade básica (health check GET /health, logging estruturado com Pino) — Validated in Phase 1: foundation
- [x] `apps/` directory com Brain packages — Validated in Phase 4: apps/brain-echo (IBrain + BrainRunner end-to-end)
- [x] Brain SDK: IBrain interface + BrainRunner lifecycle (init → run) + ToolsRegistry — Validated in Phase 4: EchoBrain exercita contrato completo com LLM real
- [x] Transport layer (Webhook): POST /api/v1/webhook traversa BrainRunner → LangGraph → resposta — Validated in Phase 4: SC-2 smoke test com LLM real
- [x] Tools Registry: registerBrainType + enableTool por tipo de Brain — Validated in Phase 4: EchoBrain registrado sem tools
- [x] Docker: multi-stage Dockerfile (node:22-slim builder + oven/bun:1 runner), imagem por Brain — Validated in Phase 4: brain-echo-test 419MB, startup fail-fast, migrations na imagem
- [x] PostgresSaver: estado LangGraph persistido no PostgreSQL, dura container restart — Validated in Phase 4: SC-3 (MARKER_BRAINCORE_42 sobreviveu docker restart)

### Active

- [ ] Transport layer (RabbitMQ): seleção via `TRANSPORT=rabbitmq` env
- [ ] Arquitetura de memória semântica (embeddings + RAG): busca por similaridade em produção

### Out of Scope

- Implementações de Brain específicos (SDR, Suporte, CS) — v1 é só infraestrutura
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar

## Context

**Estado v1.0 (shipped 2026-06-13):** ~7.094 linhas TypeScript, 8 pacotes (shared, database, observability, ai, memory, transport, core + brain-echo app), 234 commits, 23 dias de desenvolvimento.

Stack validado: Bun + Hono + Drizzle (postgres.js driver) + LangGraph + PostgresSaver + pgvector + Pino + Langfuse.

O sistema foi projetado para suportar múltiplos tipos de Brain, cada um com prompts, tools, embeddings e fluxos próprios. Todos os prompts ficam no banco de dados para permitir atualização sem deploy. O cliente usa apenas a imagem do Brain contratado.

O Brain SDR tem uma arquitetura com sub-agente de qualificação: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar (identificar perfil, orçamento, necessidade, momento de compra). O resultado volta para o Brain principal continuar a conversa.

Brains planejados para o futuro: SDR, Suporte, Customer Success, Cobrança, RH, Jurídico, E-commerce, Agendamento.

**Tech debt v1.0 para v2:** MEM-03 (semantic write path inativo), OBS-02 (transport status no /health), WebhookTransport.start() sem runner injection, TenantPoolManager não ativado em produção, lint scripts ausentes nos pacotes. Ver `.planning/milestones/v1.0-MILESTONE-AUDIT.md` para detalhes completos.

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
| Hono sobre Express | Melhor integração com Bun, zero deps, performance superior | ✓ Good — sem fricção em nenhuma das 4 fases; roteamento de sub-apps em brain-echo trivial |
| Drizzle sobre Prisma | Lightweight, TypeScript nativo, sem geração de client, melhor com Bun | ✓ Good — migrations funcionaram; único ajuste: usar `postgres.js` como driver (não `bun:sql`) por bug de conexão após constraint errors |
| Brain SDK no core desde v1 | Consistência no registro de Brains; evita refatoração quando criar o primeiro Brain | ✓ Good — brain-echo integrou sem atrito; BrainRegistry exportado mas brain-echo passa objeto diretamente (arch decision, não regressão) |
| 1 banco por cliente (inicial) | Isolamento simples agora; migrar para tenant_id quando escala demandar | ⚠️ Revisit — TenantPoolManager implementado mas brain-echo usa DATABASE_URL direto; multi-tenancy via DATABASE_NAME é infrastructure-ready mas inativo em produção |
| Tools Registry por tipo de Brain | Cada tipo define seu conjunto base de tools no código | ✓ Good — whitelist Map<brainType, Set<toolName>> funcionou; brain-echo registrado sem tools sem problemas |
| v1 = só infraestrutura core | Nenhum Brain específico no v1; garantir base sólida antes de implementar SDR/Suporte | ✓ Good — decisão validada; base sólida com 28/30 requirements satisfeitos e SC-2/SC-3 verificados |
| postgres.js como driver Drizzle (não bun:sql) | Bug de conexão travada após constraint errors no bun:sql | ✓ Good — zero problemas com postgres.js durante todo o desenvolvimento |
| WebhookTransport bypassed em brain-echo | brain-echo usa createWebhookApp(runner) diretamente (GAP-1 workaround) | ⚠️ Revisit — WebhookTransport.start() ainda cria app sem injeção de runner; classe não usada em produção mas é latent trap via ITransport interface |

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
*Last updated: 2026-06-13 after v1.0 milestone — Brain Core MVP shipped, 4 phases, 28/30 requirements satisfied, SC-2/SC-3 human verified*
