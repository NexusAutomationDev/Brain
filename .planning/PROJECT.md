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

### Active

- [ ] `apps/` directory com Brain packages (SDR, Suporte, etc.)
- [ ] Brain SDK: interface de plugin no core para registro e declaração de Brains
- [ ] Transport layer: Webhook e RabbitMQ, selecionados via `ENV=TRANSPORT`
- [ ] Tools Registry: habilitar/desabilitar ferramentas por tipo de Brain
- [ ] Arquitetura de memória em 3 camadas: short-term, long-term, semantic (embeddings)
- [ ] Docker: runtime Bun, estrutura para imagens por Brain

### Out of Scope

- Implementações de Brain específicos (SDR, Suporte, CS) — v1 é só infraestrutura
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar

## Context

O sistema foi projetado para suportar múltiplos tipos de Brain, cada um com prompts, tools, embeddings e fluxos próprios. Todos os prompts ficam no banco de dados para permitir atualização sem deploy. O cliente usa apenas a imagem do Brain contratado.

O Brain SDR tem uma arquitetura com sub-agente de qualificação: o Brain principal conversa com leads e aciona o sub-agente quando chega o momento de qualificar (identificar perfil, orçamento, necessidade, momento de compra). O resultado volta para o Brain principal continuar a conversa.

Brains planejados para o futuro: SDR, Suporte, Customer Success, Cobrança, RH, Jurídico, E-commerce, Agendamento.

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
| Hono sobre Express | Melhor integração com Bun, zero deps, performance superior | — Pending |
| Drizzle sobre Prisma | Lightweight, TypeScript nativo, sem geração de client, melhor com Bun | — Pending |
| Brain SDK no core desde v1 | Consistência no registro de Brains; evita refatoração quando criar o primeiro Brain | — Pending |
| 1 banco por cliente (inicial) | Isolamento simples agora; migrar para tenant_id quando escala demandar | — Pending |
| Tools Registry por tipo de Brain | Cada tipo define seu conjunto base de tools no código | — Pending |
| v1 = só infraestrutura core | Nenhum Brain específico no v1; garantir base sólida antes de implementar SDR/Suporte | — Pending |

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
*Last updated: 2026-06-11 — Phase 1 (foundation) complete*
