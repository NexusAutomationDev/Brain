# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](.planning/milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-06-13</summary>

- [x] Phase 1: Foundation (7/7 plans) — monorepo scaffold, PostgreSQL + PGVector, TenantPoolManager, GET /health
- [x] Phase 2: Domain Packages (11/11 plans) — memory 3-layer, AI/LangGraph + PostgresSaver, transport webhook, Langfuse
- [x] Phase 3: Brain SDK (5/5 plans) — IBrain, BrainRunner, ToolsRegistry, prompts no banco
- [x] Phase 4: Validation Brain (5/5 plans) — brain-echo Docker image, SC-2/SC-3 human verified

</details>

### 🚧 v1.1 Brain SDR + Infraestrutura Produção (In Progress)

**Milestone Goal:** Implementar o primeiro Brain real (SDR) sobre a infraestrutura consolidada — com transport RabbitMQ, schema de leads, fluxo de atendimento e correções estruturais pendentes do v1.0.

- [ ] **Phase 5: Transport Foundation** - Corrige GAP-1, padroniza BrainEvent schema e ativa lint no monorepo
- [ ] **Phase 6: Leads Schema + Migration** - Cria tabela `leads` com UNIQUE constraint e auto-migrate na inicialização
- [ ] **Phase 7: LeadService + RabbitMQ Transport** - Cadastro automático de leads, gate ia_ativada e consumer RabbitMQ com DLX
- [ ] **Phase 8: BrainRunner + Conversation History** - Vincula thread_id ao lead, recupera contexto entre sessões e controla janela de contexto
- [ ] **Phase 9: Brain SDR** - Primeiro Brain real com qualificação, sub-agente e TenantPoolManager em produção

## Phase Details

### Phase 5: Transport Foundation
**Goal**: WebhookTransport funciona corretamente com runner injetado, BrainEvent tem campos padronizados e todos os pacotes do monorepo têm lint configurado
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: TRP-02, INFRA-02
**Success Criteria** (what must be TRUE):
  1. POST /api/v1/webhook com payload `{Name, Message, Numero, IDLead}` invoca o Brain e retorna resposta LLM — sem silent accept sem processamento
  2. WebhookTransport.start() injetado via construtor resolve o runner corretamente, não lança exceção nem retorna vazio
  3. `bun run lint` passa sem erros em todos os pacotes do monorepo (shared, database, observability, ai, memory, transport, core)
  4. Fixtures de teste do webhook atualizadas para o novo schema de campos — todos os testes existentes passam com os novos nomes de campo
**Plans**: 2 plans
Plans:
- [ ] 05-01-PLAN.md — BrainEvent schema + runner injection + atualização de todos os consumidores e testes
- [ ] 05-02-PLAN.md — ESLint @typescript-eslint deps no root + script lint nos 7 pacotes

### Phase 6: Leads Schema + Migration
**Goal**: Tabela `leads` existe no banco com constraint UNIQUE em `numero`, e o Brain verifica/cria tabelas automaticamente na inicialização — nunca aceita mensagens sem schema pronto
**Depends on**: Phase 5
**Requirements**: LEAD-01, LEAD-04
**Success Criteria** (what must be TRUE):
  1. Migration SQL cria tabela `leads` (id, unique_id, nome, numero, ia_ativada, fullpp) com UNIQUE constraint em `numero` — `users` não é removida
  2. Brain inicializa contra banco vazio e cria todas as tabelas necessárias antes de aceitar a primeira mensagem
  3. Startup race condition prevenida — advisory lock em `runMigrations()` garante que múltiplas instâncias não colidem
  4. Schema `leads` exportado do barrel do pacote database e disponível para importação em outros pacotes
**Plans**: TBD

### Phase 7: LeadService + RabbitMQ Transport
**Goal**: Lead é registrado automaticamente na primeira mensagem, leads com `ia_ativada=false` são ignorados silenciosamente, e o transport RabbitMQ consume mensagens com ack manual, DLX e reconexão automática
**Depends on**: Phase 6
**Requirements**: LEAD-02, LEAD-03, TRP-01, TRP-03, TRP-04, TRP-05, TRP-06
**Success Criteria** (what must be TRUE):
  1. Primeira mensagem de um número desconhecido cria o lead automaticamente via upsert — mensagens subsequentes do mesmo número não criam duplicatas
  2. Mensagem de lead com `ia_ativada=false` é descartada silenciosamente antes de qualquer chamada LLM
  3. `TRANSPORT=rabbitmq` inicia consumer que processa mensagens `{Name, Message, Numero, IDLead}` da fila configurada via ENV — mensagem processada com sucesso recebe ack
  4. Falha permanente no processamento envia mensagem para Dead Letter Queue (não requeue infinito) — consumer não trava nem perde mensagens
  5. `TRANSPORT=webhook` mantém comportamento anterior — seleção via ENV funciona sem recompilação
**Plans**: TBD

### Phase 8: BrainRunner + Conversation History
**Goal**: Cada lead tem histórico de conversa persistente vinculado ao seu `unique_id` como `thread_id`, recuperado automaticamente entre sessões, com janela de contexto controlada
**Depends on**: Phase 7
**Requirements**: HIST-01, HIST-02, HIST-03
**Success Criteria** (what must be TRUE):
  1. `BrainRunner.run()` deriva `thread_id = lead.unique_id` após lookup no DB — nunca usa `IDLead` direto do payload como thread_id
  2. Lead que retorna após dias tem histórico completo de conversa anterior recuperado pelo PostgresSaver automaticamente
  3. Conversas longas (30-80 turnos) não causam overflow — `trimMessages` trunca o contexto respeitando o limite configurado via ENV
**Plans**: TBD

### Phase 9: Brain SDR
**Goal**: Brain SDR atende leads reais no WhatsApp com contexto de conversa, respeita ia_ativada, registra todas as interações, usa prompts do banco e executa sub-agente de qualificação quando acionado
**Depends on**: Phase 8
**Requirements**: SDR-01, SDR-02, SDR-03, SDR-04, SDR-05, INFRA-01
**Success Criteria** (what must be TRUE):
  1. Brain SDR recebe mensagem de lead ativo, recupera contexto e responde com uma única mensagem seguindo prompt armazenado no banco — zero prompts hardcoded
  2. Brain SDR nunca processa mensagem de lead com `ia_ativada=false` — verifica via LeadService antes de qualquer invocação LLM
  3. Toda interação do Brain SDR (mensagem recebida + resposta gerada) é persistida no banco e recuperável
  4. Sub-agente de qualificação retorna `{qualificado, motivo, proximo_passo}` ao Brain principal após analisar histórico completo (mensagens IA vs lead) buscado pelo serviço de código via session ID
  5. TenantPoolManager seleciona o banco correto via `DATABASE_NAME` ENV — Brain SDR opera em produção com isolamento multi-tenant
**UI hint**: no
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 7/7 | Complete | 2026-06-13 |
| 2. Domain Packages | v1.0 | 11/11 | Complete | 2026-06-13 |
| 3. Brain SDK | v1.0 | 5/5 | Complete | 2026-06-13 |
| 4. Validation Brain | v1.0 | 5/5 | Complete | 2026-06-13 |
| 5. Transport Foundation | v1.1 | 0/2 | Planned | - |
| 6. Leads Schema + Migration | v1.1 | 0/? | Not started | - |
| 7. LeadService + RabbitMQ Transport | v1.1 | 0/? | Not started | - |
| 8. BrainRunner + Conversation History | v1.1 | 0/? | Not started | - |
| 9. Brain SDR | v1.1 | 0/? | Not started | - |
