# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 MCP Integration + Dynamic responseMode** — Phases 14-17 (shipped 2026-06-16) — [archive](milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 RAG + Eventos de Tools + FUP Automático** — Phases 19-22 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-06-13</summary>

- [x] Phase 1: Foundation (7/7 plans) — monorepo scaffold, PostgreSQL + PGVector, TenantPoolManager, GET /health
- [x] Phase 2: Domain Packages (11/11 plans) — memory 3-layer, AI/LangGraph + PostgresSaver, transport webhook, Langfuse
- [x] Phase 3: Brain SDK (5/5 plans) — IBrain, BrainRunner, ToolsRegistry, prompts no banco
- [x] Phase 4: Validation Brain (5/5 plans) — brain-echo Docker image, SC-2/SC-3 human verified

</details>

<details>
<summary>✅ v1.1 Brain SDR + Infraestrutura Produção (Phases 5-9) — SHIPPED 2026-06-14</summary>

- [x] Phase 5: Transport Foundation (2/2 plans) — BrainEvent padronizado, WebhookTransport runner injection, lint 7/7 pacotes
- [x] Phase 6: Leads Schema + Migration (2/2 plans) — leadsTable, advisory lock, BrainRunner auto-migrate
- [x] Phase 7: LeadService + RabbitMQ Transport (2/2 plans) — upsertLead, gate ia_ativada, RabbitMQTransport com DLQ
- [x] Phase 8: BrainRunner + Conversation History (2/2 plans) — thread_id=lead.uniqueId, PostgresSaver, context window
- [x] Phase 9: Brain SDR (4/4 plans) — Brain SDR ReAct + qualifier stateless + TenantPoolManager + Dockerfile

</details>

<details>
<summary>✅ v1.2 Output Parser + Tool Contracts (Phases 10-13) — SHIPPED 2026-06-15</summary>

- [x] Phase 10: Output Parser SDK (5/5 plans) — BrainOutput type + BrainOutputSchema Zod + BrainRunner validation — completed 2026-06-15
- [x] Phase 11: Tool Contracts SDK (2/2 plans) — BRAIN_TOOLS ENV guard + createPauseSessionTool + createFinishConversationTool — completed 2026-06-15
- [x] Phase 12: Brain SDR Integration (2/2 plans) — Brain SDR migrado para contrato v1.2, webhook retorna BrainOutput — completed 2026-06-15
- [x] Phase 13: Suporte a PgBouncer (2/2 plans) — prepare:false + row-lock + CR-01 connection leak fix — completed 2026-06-15

</details>

<details>
<summary>✅ v1.3 MCP Integration + Dynamic responseMode (Phases 14-17) — SHIPPED 2026-06-16</summary>

- [x] Phase 14: TD-01 Fix (1/1 plan) — qualifier.ts com prepare: false, compatível com PgBouncer transaction mode — completed 2026-06-16
- [x] Phase 15: MCP Integration (3/3 plans) — BrainRunner carrega MCP tools no startup, SIGTERM limpo em 511ms — completed 2026-06-16
- [x] Phase 16: Dynamic responseMode (2/2 plans) — createRespondTool + routeAfterLlm + nó respond, multi-provider — completed 2026-06-16
- [x] Phase 17: Token Usage Exposure (3/3 plans) — tokenUsage acumulado via BrainStateAnnotation, exposto em HTTP e RabbitMQ — completed 2026-06-16

</details>

### 🚧 v1.4 RAG + Eventos de Tools + FUP Automático (In Progress)

**Milestone Goal:** Dar aos Brains base de conhecimento semântica, expor resultados de tools para sistemas externos via canal dedicado, e enviar follow-ups automáticos para leads que param de responder.

- [ ] **Phase 19: Database Foundation** - Migration única com todas as tabelas e colunas necessárias para RAG, Tool Events e FUP
- [ ] **Phase 20: Tool Events** - Canal de saída separado publicando resultado de cada tool via webhook ou RabbitMQ
- [ ] **Phase 21: RAG** - Base de conhecimento semântica com ingest endpoint e tool search_knowledge
- [ ] **Phase 22: FUP Automático** - Scheduler que detecta leads silenciosos e envia follow-ups personalizados

## Phase Details

### Phase 19: Database Foundation
**Goal**: Schema estável para v1.4 disponível para todos os Brains — tabelas e colunas criadas em migration única antes que qualquer feature de RAG, Tool Events ou FUP seja implementada
**Depends on**: Phase 18
**Requirements**: FUP-04, FUP-06
**Success Criteria** (what must be TRUE):
  1. Migration `0007_v1_4_foundation` aplica sem erro em banco limpo e em banco com dados existentes
  2. Tabela `knowledge_chunks` existe com colunas `collection`, `embedding`, `content`, `embedding_model`, `chunk_index`, `total_chunks` e metadados obrigatórios não-nulos
  3. Tabela `fup_config` existe com colunas de configuração de intervalos, horários, dias e fuso horário
  4. Tabela `leads` possui colunas `fup_enabled`, `fup_step`, `fup_next_at` e `last_message_at`
  5. `BrainRunner.run()` chama `LeadService.touchLastMessage()` a cada mensagem recebida, atualizando `last_message_at` incondicionalmente
**Plans**: TBD

### Phase 20: Tool Events
**Goal**: Brains publicam automaticamente o resultado de cada tool relevante em canal de saída separado (webhook ou RabbitMQ), sem bloquear o fluxo principal
**Depends on**: Phase 19
**Requirements**: EVT-01, EVT-02, EVT-03, EVT-04
**Success Criteria** (what must be TRUE):
  1. Ao configurar `TOOL_EVENTS_URL` via ENV, cada execução de `qualify_lead`, `pause_session` ou `finish_conversation` dispara um POST fire-and-forget com `{ event_id, action, lead, result, timestamp }` para a URL configurada
  2. Ao configurar `TOOL_EVENTS_QUEUE` via ENV, os mesmos eventos são publicados na fila RabbitMQ correspondente
  3. Cada evento carrega `event_id` derivado de `thread_id:tool_call_id` — dois eventos do mesmo tool call produzem o mesmo `event_id`
  4. Publicação de evento nunca bloqueia nem atrasa a resposta do Brain ao lead
  5. Quando nenhum ENV de Tool Events está configurado, o sistema funciona normalmente sem publicar eventos
**Plans**: TBD
**UI hint**: no

### Phase 21: RAG
**Goal**: Operador pode ingerir texto em coleções via API e o LLM pode buscar contexto relevante chamando `search_knowledge` — base de conhecimento semântica disponível para todos os Brains
**Depends on**: Phase 19
**Requirements**: RAG-01, RAG-02, RAG-03, RAG-04
**Success Criteria** (what must be TRUE):
  1. POST /api/v1/ingest com `{ text, collection }` e header `Authorization: Bearer <INGEST_TOKEN>` chunka o texto, gera embeddings e armazena no pgvector; requisição sem token válido retorna 401
  2. O LLM pode chamar `search_knowledge(query, collections[])` e receber trechos ordenados por similaridade cosine acima do threshold configurado
  3. Uma chamada a `search_knowledge` com múltiplas coleções retorna resultados de todas elas em único response, ordenados por score
  4. Cada chunk armazenado registra `collection_name`, `embedding_model`, `chunk_index` e `total_chunks` como metadados não-nulos — campo `embedding_model` permite detectar drift de modelo
**Plans**: TBD

### Phase 22: FUP Automático
**Goal**: Leads que param de responder recebem follow-ups personalizados gerados por LLM em intervalos configuráveis, respeitando horário comercial e fuso horário — com controle de etapa no DB e desativação automática no último FUP
**Depends on**: Phase 19, Phase 20
**Requirements**: FUP-01, FUP-02, FUP-03, FUP-05, FUP-06, FUP-07, FUP-08
**Success Criteria** (what must be TRUE):
  1. Lead que para de responder recebe mensagem de FUP gerada por LLM usando o histórico da conversa, no intervalo configurado em `fup_config`, respeitando `fup_min_hour`, `fup_max_hour`, dias permitidos e fuso horário IANA
  2. Quando o lead responde, todos os FUPs pendentes são cancelados e `last_message_at` é atualizado — FUP não dispara para leads ativos
  3. Ao enviar o último FUP da sequência, o sistema seta `ia_ativada = false` e `fup_enabled = false` automaticamente
  4. Múltiplas instâncias do Brain em paralelo nunca enviam o mesmo FUP duas vezes — `SELECT FOR UPDATE SKIP LOCKED` garante que apenas uma instância processa cada FUP
  5. Se LLM ou transport falhar ao enviar FUP, o sistema re-tenta até 3 vezes antes de marcar como falha e logar alerta; se a janela de horário não permitir envio, o scheduler agenda para o próximo slot válido
**Plans**: TBD

## Progress

**Execution Order:** Phases execute in numeric order: 19 → 20 → 21 → 22

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 7/7 | Complete | 2026-06-13 |
| 2. Domain Packages | v1.0 | 11/11 | Complete | 2026-06-13 |
| 3. Brain SDK | v1.0 | 5/5 | Complete | 2026-06-13 |
| 4. Validation Brain | v1.0 | 5/5 | Complete | 2026-06-13 |
| 5. Transport Foundation | v1.1 | 2/2 | Complete | 2026-06-13 |
| 6. Leads Schema + Migration | v1.1 | 2/2 | Complete | 2026-06-14 |
| 7. LeadService + RabbitMQ Transport | v1.1 | 2/2 | Complete | 2026-06-14 |
| 8. BrainRunner + Conversation History | v1.1 | 2/2 | Complete | 2026-06-14 |
| 9. Brain SDR | v1.1 | 4/4 | Complete | 2026-06-14 |
| 10. Output Parser SDK | v1.2 | 5/5 | Complete | 2026-06-15 |
| 11. Tool Contracts SDK | v1.2 | 2/2 | Complete | 2026-06-15 |
| 12. Brain SDR Integration | v1.2 | 2/2 | Complete | 2026-06-15 |
| 13. Suporte a PgBouncer | v1.2 | 2/2 | Complete | 2026-06-15 |
| 14. TD-01 Fix | v1.3 | 1/1 | Complete | 2026-06-16 |
| 15. MCP Integration | v1.3 | 3/3 | Complete | 2026-06-16 |
| 16. Dynamic responseMode | v1.3 | 2/2 | Complete | 2026-06-16 |
| 17. Expor contagem de tokens gastos | v1.3 | 3/3 | Complete | 2026-06-16 |
| 18. Build and Publish Docker Image via DockGate | — | 0/1 | Planned | — |
| 19. Database Foundation | v1.4 | 0/? | Not started | — |
| 20. Tool Events | v1.4 | 0/? | Not started | — |
| 21. RAG | v1.4 | 0/? | Not started | — |
| 22. FUP Automático | v1.4 | 0/? | Not started | — |

## Backlog

### Phase 999.1: responseMode dinâmico via structured output multi-provider (BACKLOG)

**Goal:** Eliminar o hardcode `responseMode: "text"` no brain.ts — o LLM sinaliza o modo correto (text/audio/etc) via API de structured output do provider, não via instrução no system prompt. Suporte obrigatório para OpenAI e Google (Gemini). Parsing robusto com fallback no brain.ts.

**Context:** Hoje o brain-sdr sempre retorna `responseMode: "text"`. O system prompt contém o bloco `<response_format>` como referência comportamental (o LLM conhece os modos), mas sem um mecanismo de saída estruturada o LLM não consegue sinalizar `"audio"` quando o usuário pede. A solução correta é usar `response_format` (OpenAI) ou `generationConfig.responseMimeType` (Google) no nível da API — não instrução de prompt.

**Requirements:** TBD
**Plans:** 3/3 plans complete

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 18: Build and Publish Docker Image via DockGate

**Goal:** Criar o pipeline de CI/CD (GitHub Actions) que builda a imagem Docker do brain-sdr e publica via DockGate — o registry Docker auto-hospedado do projeto, com API sobre MinIO. Disparado por push de tag semver v*.*.*.
**Requirements**: DOCKER-BUILD-01, DOCKER-EXPORT-01, DOCKGATE-UPLOAD-01, DOCKGATE-PUBLISH-01
**Depends on:** Phase 17
**Plans:** 1 plan

Plans:
- [ ] 18-01-PLAN.md — Criar .github/workflows/publish-brain-sdr.yml com pipeline completo de build, export e publicação no DockGate
