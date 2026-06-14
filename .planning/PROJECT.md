# Brain Core

## What This Is

Plataforma monorepo para construção de agentes de IA especializados (Brains). Cada Brain — SDR, Suporte, Customer Success, etc. — é empacotado como uma imagem Docker independente, mas compartilha o mesmo núcleo de infraestrutura: transport, memória, embeddings, Tools Registry e Brain SDK. O produto é vendido/distribuído para clientes que contratam o Brain adequado ao seu caso de uso.

## Core Value

Uma infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base.

## Current Milestone: v1.1 Brain SDR + Infraestrutura Produção

**Goal:** Implementar o primeiro Brain real (SDR) sobre a infraestrutura consolidada — com transport RabbitMQ, schema de leads, fluxo de atendimento e correções estruturais pendentes do v1.0.

**Target features:**
- Transport RabbitMQ + Webhook com campos padronizados (Name, Message, Numero, IDLead)
- Auto-migrate na inicialização do Brain (verifica e cria tabelas se não existirem)
- Schema: tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) substituindo `users`
- Fluxo de cadastro automático de leads na primeira mensagem + verificação `ia_ativada`
- Histórico de conversas vinculado ao lead com recuperação de contexto
- Correção do WebhookTransport.start() (bug de runner injection)
- Revisão e ativação do Multi-tenant via TenantPoolManager
- Brain SDR: primeiro atendimento de leads com contexto de conversa, respeito ao `ia_ativada`, registro de interações

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

- [ ] Transport layer (RabbitMQ): seleção via `TRANSPORT=rabbitmq` env com campos padronizados (Name, Message, Numero, IDLead) — v1.1
- [x] Schema: tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) com advisory lock em runMigrations() — Validated in Phase 6: leads-schema-migration
- [x] Auto-migrate na inicialização do Brain (verificar/criar tabelas via ENV) — Validated in Phase 6: leads-schema-migration
- [ ] Fluxo: cadastro automático de lead na primeira mensagem + verificação `ia_ativada` — v1.1
- [ ] Histórico de conversas vinculado ao lead (recuperação de contexto entre sessões) — v1.1
- [x] Correção WebhookTransport.start() com runner injection (GAP-1) — Validated in Phase 5: transport-foundation
- [x] Webhook: campos de entrada padronizados (Name, Message, Numero, IDLead) — Validated in Phase 5: transport-foundation
- [x] Lint pipeline ativo em todos os 7 pacotes (turbo run lint passa 7/7) — Validated in Phase 5: transport-foundation
- [ ] Multi-tenant: revisão e ativação do TenantPoolManager em produção — v1.1
- [ ] Brain SDR: primeiro Brain real com fluxo de atendimento, qualificação e sub-agente — v1.1
- [ ] Arquitetura de memória semântica (embeddings + RAG): busca por similaridade em produção

### Out of Scope

- Brain SDR com sub-agente de qualificação avançada (SPIN/BANT completo) — pós v1.1
- Outros Brains específicos (Suporte, CS, Cobrança, RH) — pós v1.1
- Mecanismo de licenciamento (LICENSE_KEY) — futuro
- UI de gerenciamento de Brains — futuro
- Migração para tenant_id nas tabelas — futuro quando escala demandar
- fullpp com regra de negócio — futuro

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
| WebhookTransport runner injection (GAP-1 fix) | WebhookTransport agora recebe runner via construtor; start() lança ConfigurationError se ausente | ✓ Fixed in Phase 5 — constructor injection, fail-fast ConfigurationError, factory atualizada |

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
*Last updated: 2026-06-13 — Phase 5 complete: GAP-1 fix, BrainEvent schema padronizado, lint ativo em 7 pacotes*
