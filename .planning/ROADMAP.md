# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 MCP Integration + Dynamic responseMode** — Phases 14-17 (shipped 2026-06-16) — [archive](milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 RAG + Eventos de Tools + FUP Automático** — Phases 19-25 (in progress)

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

- [x] **Phase 19: Database Foundation** - Migration única com todas as tabelas e colunas necessárias para RAG, Tool Events e FUP (completed 2026-06-23)
- [x] **Phase 20: Tool Events** - Canal de saída separado publicando resultado de cada tool via webhook ou RabbitMQ (completed 2026-06-23)
- [x] **Phase 21: RAG** - Base de conhecimento semântica com ingest endpoint e tool search_knowledge (completed 2026-06-24)
- [x] **Phase 22: FUP Automático** - Scheduler que detecta leads silenciosos e envia follow-ups personalizados (completed 2026-06-24)
- [x] **Phase 23: RAG Wiring Fix** - Vincular createSearchKnowledgeTool ao LLM em brain-sdr/brain.ts — fecha RAG-02, RAG-03 (completed 2026-06-24)
- [x] **Phase 24: Tech Debt & Tracker Cleanup** - Corrigir WR-01..WR-04, 4 erros TypeScript, atualizar REQUIREMENTS.md tracker (completed 2026-06-24)
- [x] **Phase 25: FUP Activation Trigger** - Ativar fup_enabled automaticamente ao criar/configurar lead para FUP disparar sem intervenção manual (completed 2026-06-25)
- [ ] **Phase 26: FUP Next-At Init Fix** - Setar fupNextAt no INSERT ao ativar FUP — fecha gap bloqueador FUP-02 (wiring Phase 25 → Phase 22)

## Phase Details

### Phase 26: FUP Next-At Init Fix
**Goal**: Fechar o gap bloqueador entre Phase 25 e Phase 22 — `upsertLead()` deve calcular e persistir `fupNextAt` no INSERT quando `fupEnabled=true`, tornando o FUP automático operacional em produção para todos os leads criados com FUP ativado
**Depends on**: Phase 25
**Requirements**: FUP-02
**Gap Closure**: Fecha gap bloqueador identificado na auditoria v1.4 — FUP-02 partial, integration gap Phase 25 → Phase 22, flow "FUP Activation E2E"
**Success Criteria** (what must be TRUE):
  1. `LeadService.upsertLead()` calcula e persiste `fupNextAt = NOW() + intervals_seconds[0]` (ajustado para próximo slot dentro de business hours) no INSERT quando `fupEnabled=true`
  2. `FupScheduler._tick()` processa leads recém-criados com FUP ativado — `fup_next_at <= NOW()` satisfeito dentro do intervalo configurado
  3. Flow FUP Activation E2E completo: novo lead → `fupEnabled=true`, `fupNextAt` setado → scheduler processa → FUP enviado
  4. Spec EVT-04 atualizada documentando que FUP events usam `event_id = uniqueId:fup:step` (divergência intencional de `thread_id:tool_call_id`)
**Plans**: 1 plan

Plans:
- [ ] 26-01-PLAN.md — Modificar `LeadService.upsertLead()` para calcular e setar `fupNextAt` no INSERT + testes + docs EVT-04

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
**Plans**: 2 plans

Plans:
- [x] 19-01-PLAN.md — Migration 0007_v1_4_foundation com todas as tabelas (knowledge_chunks, fup_config) e colunas (leads.fup_*)
- [x] 19-02-PLAN.md — Integrar LeadService.touchLastMessage() no BrainRunner.run() antes do gate ia_ativada

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
**Plans**: 2 plans
**UI hint**: no

Plans:
- [x] 20-01-PLAN.md — EventPublisher class com suporte a webhook e RabbitMQ + NoopEventPublisher + testes unitários (EVT-01, EVT-04)
- [x] 20-02-PLAN.md — Integração EventPublisher no BrainRunner + whitelist de tools + barrel export (EVT-02, EVT-03)

### Phase 21: RAG
**Goal**: Operador pode ingerir texto em coleções via API e o LLM pode buscar contexto relevante chamando `search_knowledge` — base de conhecimento semântica disponível para todos os Brains
**Depends on**: Phase 19
**Requirements**: RAG-01, RAG-02, RAG-03, RAG-04
**Success Criteria** (what must be TRUE):
  1. POST /api/v1/ingest com `{ text, collection }` e header `Authorization: Bearer <INGEST_TOKEN>` chunka o texto, gera embeddings e armazena no pgvector; requisição sem token válido retorna 401
  2. O LLM pode chamar `search_knowledge(query, collections[])` e receber trechos ordenados por similaridade cosine acima do threshold configurado
  3. Uma chamada a `search_knowledge` com múltiplas coleções retorna resultados de todas elas em único response, ordenados por score
  4. Cada chunk armazenado registra `collection_name`, `embedding_model`, `chunk_index` e `total_chunks` como metadados não-nulos — campo `embedding_model` permite detectar drift de modelo
**Plans**: 3 plans

Plans:
- [x] 21-01-PLAN.md — Test stubs (Wave 0 / Nyquist) + D-17 factory update (createEmbeddings defaults por provider)
- [x] 21-02-PLAN.md — RAG core: chunker.ts + search.ts + ingest.ts (POST /api/v1/ingest)
- [x] 21-03-PLAN.md — createSearchKnowledgeTool + barrel export @brain-pkg/core + integração brain-sdr

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
**Plans**: 3 plans

Plans:
- [x] 22-01-PLAN.md — Migration 0008 + schema Drizzle para fup_failure_count
- [x] 22-02-PLAN.md — FupScheduler (classe + lógica de negócio + testes unitários)
- [x] 22-03-PLAN.md — Integração BrainRunner + LeadService.resetFup() + barrel export + schema push

### Phase 23: RAG Wiring Fix
**Goal**: Vincular `createSearchKnowledgeTool` ao LLM em `apps/brain-sdr/src/brain.ts` — o ingest já funciona, mas o LLM nunca enxerga `search_knowledge` porque a tool não está no `bindTools()` nem no `ToolNode` do Brain SDR
**Depends on**: Phase 21, Phase 22
**Requirements**: RAG-02, RAG-03
**Gap Closure**: Fecha gaps RAG-02, RAG-03 e integration gap Phase 21 → buildGraph()
**Success Criteria** (what must be TRUE):
  1. `buildGraph()` em `apps/brain-sdr/src/brain.ts` instancia `createSearchKnowledgeTool(ctx.sql!)` e adiciona ao `bindTools()` e ao `ToolNode`
  2. O LLM pode chamar `search_knowledge` e receber trechos ordenados por similaridade — fluxo RAG end-to-end funcional
  3. Teste de integração confirma que o LLM recebe chunks relevantes ao consultar uma coleção previamente ingerida
**Plans**: 1 plan

Plans:
- [x] 23-01-PLAN.md — Wiring de createSearchKnowledgeTool em buildGraph() + testes unitários atualizados

### Phase 24: Tech Debt & Tracker Cleanup
**Goal**: Corrigir debt técnico acumulado de v1.4 — WR-01..WR-04 no FupScheduler, 4 erros TypeScript pré-existentes em packages/core, e atualizar REQUIREMENTS.md tracker para refletir estado real do código
**Depends on**: Phase 22
**Requirements**: (nenhum requirement novo — closes tech debt)
**Gap Closure**: Fecha itens de tech debt identificados na auditoria v1.4
**Success Criteria** (what must be TRUE):
  1. FupScheduler loga warning quando `FUP_WEBHOOK_URL` está configurado mas `checkpointer` é null (WR-01)
  2. `resetFup()` inclui `updatedAt` na atualização — consistente com outros métodos do LeadService (WR-02)
  3. SIGTERM listener é removido em `close()` do FupScheduler — sem acúmulo de listeners em chamadas múltiplas (WR-03)
  4. FupScheduler adiciona delay entre retries — sem 30 calls simultâneos ao LLM em cenário de falha (WR-04)
  5. `bun tsc --noEmit` em packages/core retorna 0 erros (4 erros TypeScript eliminados)
  6. REQUIREMENTS.md com checkboxes e traceability refletindo estado real do código implementado
**Plans**: 3 plans

Plans:
- [x] 24-01-PLAN.md — WR-01 (warning checkpointer null) + WR-02 (updatedAt em resetFup) + WR-03 (SIGTERM handler cleanup)
- [x] 24-02-PLAN.md — WR-04 (delay entre retries no FupScheduler)
- [x] 24-03-PLAN.md — SC-5 verificação TypeScript + atualização REQUIREMENTS.md tracker

### Phase 25: FUP Activation Trigger
**Goal**: Leads recém-criados ou configurados para FUP têm `fup_enabled` ativado automaticamente — sem necessidade de intervenção manual no banco, tornando o FUP operacional em produção sem setup adicional por lead
**Depends on**: Phase 22, Phase 23
**Requirements**: FUP-01, FUP-02 (extensão)
**Gap Closure**: Fecha integration gap "fup_enabled sem trigger automático" identificado na auditoria
**Success Criteria** (what must be TRUE):
  1. Quando `fup_config` existe no banco para o Brain, novos leads têm `fup_enabled = true` setado automaticamente via `LeadService.upsert()` ou trigger de startup
  2. O FUP dispara sem intervenção manual no banco para leads que param de responder — fluxo FUP automático completo em produção
  3. Leads que explicitamente têm `fup_enabled = false` (desativado manualmente) não são afetados pela ativação automática
**Plans**: 3 plans

Plans:
- [x] 25-01-PLAN.md — Test stubs para FUP activation (Wave 0 / Nyquist)
- [x] 25-02-PLAN.md — Modificar LeadService.upsertLead() com lógica de ativação condicional via fup_config
- [x] 25-03-PLAN.md — Wiring BrainRunner.run() para passar brainType ao upsertLead()

## Progress

**Execution Order:** Phases execute in numeric order: 19 → 20 → 21 → 22 → 23 → 24 → 25

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
| 19. Database Foundation | v1.4 | 2/2 | Complete    | 2026-06-23 |
| 20. Tool Events | v1.4 | 2/2 | Complete   | 2026-06-23 |
| 21. RAG | v1.4 | 3/3 | Complete    | 2026-06-24 |
| 22. FUP Automático | v1.4 | 3/3 | Complete   | 2026-06-24 |
| 23. RAG Wiring Fix | v1.4 | 1/1 | Complete    | 2026-06-24 |
| 24. Tech Debt & Tracker Cleanup | v1.4 | 3/3 | Complete    | 2026-06-24 |
| 25. FUP Activation Trigger | v1.4 | 3/3 | Complete    | 2026-06-25 |
| 26. FUP Next-At Init Fix | v1.4 | 0/1 | Planned     | — |

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
