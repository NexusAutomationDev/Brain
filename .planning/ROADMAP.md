# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 MCP Integration + Dynamic responseMode** — Phases 14-17 (shipped 2026-06-16) — [archive](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 RAG + Eventos de Tools + FUP Automático** — Phases 19-26 (shipped 2026-06-25) — [archive](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Embedding SDK + Brain Suporte + Tech Debt** — Phases 27-32 (shipped 2026-07-02) — [archive](milestones/v1.5-ROADMAP.md)
- 🚧 **v1.6 Transferência de Lead entre Agentes + Seed por Brain** — Phases 33-35 (in progress)

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

<details>
<summary>✅ v1.4 RAG + Eventos de Tools + FUP Automático (Phases 19-26) — SHIPPED 2026-06-25</summary>

- [x] Phase 19: Database Foundation (2/2 plans) — migration 0007 com knowledge_chunks + fup_config + colunas FUP em leads — completed 2026-06-23
- [x] Phase 20: Tool Events (2/2 plans) — IEventPublisher webhook+RabbitMQ fire-and-forget, NoopEventPublisher — completed 2026-06-23
- [x] Phase 21: RAG (3/3 plans) — POST /api/v1/ingest + chunker + cosine search pgvector + createSearchKnowledgeTool — completed 2026-06-24
- [x] Phase 22: FUP Automático (3/3 plans) — FupScheduler SELECT FOR UPDATE SKIP LOCKED + LLM one-shot + IANA timezone — completed 2026-06-24
- [x] Phase 23: RAG Wiring Fix (1/1 plan) — search_knowledge vinculada ao Brain SDR buildGraph() — completed 2026-06-24
- [x] Phase 24: Tech Debt & Tracker Cleanup (3/3 plans) — WR-01..WR-04 + 4 TS errors + REQUIREMENTS.md tracker — completed 2026-06-24
- [x] Phase 25: FUP Activation Trigger (3/3 plans) — upsertLead() ativa fup_enabled via fup_config automaticamente — completed 2026-06-25
- [x] Phase 26: FUP Next-At Init Fix (1/1 plan) — fupNextAt setado no INSERT, fecha gap FUP-02 — completed 2026-06-25

</details>

<details>
<summary>✅ v1.5 Embedding SDK + Brain Suporte + Tech Debt (Phases 27-32) — SHIPPED 2026-07-02</summary>

- [x] Phase 27: Tech Debt Fixes (3/3 plans) — BRAIN_TOOLS buildGraph coverage + FUP-02 E2E test + /health transport status
- [x] Phase 28: Embedding SDK (5/5 plans) — IEmbeddingProvider interface + OpenAI adapter + ENV-driven dimensions + semantic write path
- [x] Phase 29: Brain Suporte Core (3/3 plans) — LangGraph graph + MCP tools + RAG obrigatório + transport + BrainOutput + leads + ToolsRegistry
- [x] Phase 30: Brain Suporte Docker (3/3 plans) — Dockerfile multi-stage independente + validação end-to-end de deploy
- [x] Phase 31: Pre-Client Onboarding Hardening (1/1 plan) — CI shell hygiene + respond tool guard + .env.example docs + migration warning comment (gap closure)
- [x] Phase 32: Code Quality Cleanup (6/6 plans) — resolve WR/IN findings from phases 27-30 + backfill SUMMARY frontmatter + fix test ordering/isolation issues (gap closure)

Full details: [archive](milestones/v1.5-ROADMAP.md)

</details>

### 🚧 v1.6 Transferência de Lead entre Agentes + Seed por Brain (In Progress)

**Milestone Goal:** Corrigir o seeding de cada Brain para ser específico do seu próprio tipo (prompts + fup_config + prompt padrão de FUP) e construir a capacidade de um agente transferir um lead ativo (dados + contexto de conversa) para outro agente, possivelmente em outro banco de dados.

- [x] **Phase 33: Seed por Tipo de Brain** - Seed idempotente e escopado por brain_type para prompts + fup_config + prompt fup, sem tocar nas migrations 0002/0005/0010 existentes (completed 2026-08-13)
- [ ] **Phase 34: Fundação de Handoff (Agents + DBLink)** - Tabela `agents`, extensão `dblink` na migration compartilhada, coluna `leads.handoff_context`
- [ ] **Phase 35: Execução de Handoff (Transfer Lead)** - Tool `transfer_lead` com resumo LLM one-shot, escrita via DBLINK no destino, leitura/limpeza do contexto no destino e desativação do lead de origem

## Phase Details

(v1.5 phase details archived to [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md))

### Phase 33: Seed por Tipo de Brain

**Goal**: Cada imagem de Brain semeia, na inicialização, apenas os prompts e a configuração de FUP do seu próprio `brain_type` — FUP funciona out-of-the-box em qualquer banco novo, sem seed manual e sem contaminação cruzada entre tipos (echo/sdr/support)
**Depends on**: Nothing (novo milestone; independente das fases 1-32)
**Requirements**: SEED-01, SEED-02, SEED-03, SEED-04, SEED-05
**Success Criteria** (what must be TRUE):

  1. Uma inicialização em banco novo de qualquer Brain (sdr, support, echo) resulta em `prompts` contendo somente linhas do seu próprio `brain_type` — nenhuma linha de outro tipo é inserida (SEED-01)
  2. Um banco novo de qualquer Brain tem, automaticamente, uma linha de `fup_config` para aquele `brain_type`, sem insert manual (SEED-02)
  3. Um banco novo de qualquer Brain tem, automaticamente, um prompt `key='fup'` para aquele `brain_type` — um lead silencioso recebe FUP real sem qualquer setup manual de banco (SEED-03)
  4. Reiniciar o container do Brain múltiplas vezes contra o mesmo banco não duplica nem falha o seed (idempotente via `ON CONFLICT DO NOTHING`), independente do lock/fluxo de `runMigrations()`/`_schema_lock` (SEED-04)
  5. Bancos de clientes já em produção que aplicaram as migrations 0002/0005/0010 continuam funcionando sem qualquer migration destrutiva ou retroativa (SEED-05)

**Plans**: 3/3 plans executed

Plans:
**Wave 1**

- [x] 33-01-PLAN.md — runBrainSeed() core mechanism + brain-sdr end-to-end wiring (tracer) + unit tests

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 33-02-PLAN.md — Support + Echo seed files/Dockerfile wiring + cross-brain isolation & idempotency tests
- [x] 33-03-PLAN.md — D-10: FupScheduler persists sent FUP message into the lead's LangGraph checkpoint

### Phase 34: Fundação de Handoff (Agents + DBLink)

**Goal**: A infraestrutura de dados para transferência de lead existe e é validável isoladamente — tabela `agents` como registro de destinos, extensão `dblink` disponível por padrão em todo banco, e a coluna `leads.handoff_context` já presente no schema (seu uso ponta-a-ponta é validado na Fase 35) — antes de qualquer tool ou fluxo de transferência ser construído
**Depends on**: Phase 33 (o destino de um handoff precisa ter `fup_config`/prompt `fup` já seedado para o lead virar elegível a FUP imediatamente após a transferência via `upsertLead()`)
**Requirements**: HANDOFF-01, HANDOFF-02, HANDOFF-04, HANDOFF-10
**Success Criteria** (what must be TRUE):

  1. O schema de qualquer Brain inclui uma tabela `agents` (nome, brain_type, connection string do destino utilizável por dblink, enabled, timestamps), populável via INSERT SQL direto sem redeploy (HANDOFF-01)
  2. A migration compartilhada executa `CREATE EXTENSION IF NOT EXISTS dblink` automaticamente na inicialização — um banco novo de cliente já tem dblink disponível sem qualquer ativação manual (HANDOFF-02)
  3. Consultar `agents` por um nome desconhecido, ou por um nome com `enabled=false`, retorna um resultado de rejeição claro; consultar um nome válido e habilitado retorna sua connection string de destino (HANDOFF-04)
  4. Qualquer código relacionado a handoff resolve o `thread_id` exclusivamente a partir do contexto de execução/configurable (nunca de um argumento vindo do LLM/tool), seguindo o mesmo padrão D-04 já usado pelas outras tools (HANDOFF-10)

**Plans**: 1/2 plans executed

Plans:
**Wave 1**

- [x] 34-01-PLAN.md — agents table + leads.handoff_context column + dblink extension migration 0012, generated + applied + psql-verified against a real Postgres (tracer)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 34-02-PLAN.md — getAgentConnection() lookup function + unit tests + real-Postgres integration tests (closes Phase 33's verification gap)

### Phase 35: Execução de Handoff (Transfer Lead)

**Goal**: A IA pode decidir, via prompt de cada Brain, transferir um lead ativo para outro agente — resumo gerado por LLM one-shot a partir do histórico, escrita direta no banco de destino via DBLINK, leitura e limpeza do contexto no destino, desativação do lead de origem somente após confirmação de sucesso, e evento publicado no canal de eventos já existente
**Depends on**: Phase 34 (tabela `agents` + extensão `dblink` + coluna `handoff_context` precisam existir antes da tool poder escrever)
**Requirements**: HANDOFF-03, HANDOFF-05, HANDOFF-06, HANDOFF-07, HANDOFF-08, HANDOFF-09
**Success Criteria** (what must be TRUE):

  1. O LLM pode chamar a tool `transfer_lead` durante uma conversa — a decisão de quando transferir é definida inteiramente pelo prompt de cada Brain (sem regra hardcoded no código) — e a chamada gera um resumo one-shot da conversa a partir do histórico do checkpoint (HANDOFF-03, HANDOFF-05)
  2. Chamar `transfer_lead` com um agente de destino válido e habilitado escreve diretamente via DBLINK no banco de destino: upsert do lead (numero, nome, unique_id) e gravação do resumo gerado em `leads.handoff_context` (HANDOFF-06)
  3. Ao processar a próxima mensagem recebida desse lead, o Brain de destino lê `handoff_context`, usa como contexto inicial da conversa, e então limpa o campo — não é reaproveitado em mensagens futuras (HANDOFF-07)
  4. Somente após a escrita no destino ser confirmada com sucesso o Brain de origem desativa o lead (`ia_ativada=false` via `LeadService.setIaAtivada()`) — uma transferência com falha ou destino desconhecido/desabilitado mantém o lead de origem ativo e conversando (HANDOFF-08)
  5. Uma chamada de `transfer_lead` bem-sucedida publica um evento `{action:"transfer_lead", lead, result}` no canal de eventos já existente do Brain (webhook/RabbitMQ via `IEventPublisher`), sem nova infraestrutura de notificação (HANDOFF-09)

**Plans**: TBD

## Progress

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
| 19. Database Foundation | v1.4 | 2/2 | Complete | 2026-06-23 |
| 20. Tool Events | v1.4 | 2/2 | Complete | 2026-06-23 |
| 21. RAG | v1.4 | 3/3 | Complete | 2026-06-24 |
| 22. FUP Automático | v1.4 | 3/3 | Complete | 2026-06-24 |
| 23. RAG Wiring Fix | v1.4 | 1/1 | Complete | 2026-06-24 |
| 24. Tech Debt & Tracker Cleanup | v1.4 | 3/3 | Complete | 2026-06-24 |
| 25. FUP Activation Trigger | v1.4 | 3/3 | Complete | 2026-06-25 |
| 26. FUP Next-At Init Fix | v1.4 | 1/1 | Complete | 2026-06-25 |
| 27. Tech Debt Fixes | v1.5 | 3/3 | Complete    | 2026-06-30 |
| 28. Embedding SDK | v1.5 | 5/5 | Complete    | 2026-07-01 |
| 29. Brain Suporte Core | v1.5 | 3/3 | Complete    | 2026-07-01 |
| 30. Brain Suporte Docker | v1.5 | 3/3 | Complete    | 2026-07-01 |
| 31. Pre-Client Onboarding Hardening | v1.5 | 1/1 | Complete    | 2026-07-02 |
| 32. Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene | v1.5 | 6/6 | Complete    | 2026-07-02 |
| 33. Seed por Tipo de Brain | v1.6 | 3/3 | Complete    | 2026-08-13 |
| 34. Fundação de Handoff (Agents + DBLink) | v1.6 | 1/2 | In Progress|  |
| 35. Execução de Handoff (Transfer Lead) | v1.6 | 0/TBD | Not started | - |

## Backlog

### Phase 999.1: responseMode dinâmico via structured output multi-provider (BACKLOG)

**Goal:** Eliminar o hardcode `responseMode: "text"` no brain.ts — o LLM sinaliza o modo correto (text/audio/etc) via API de structured output do provider, não via instrução no system prompt. Suporte obrigatório para OpenAI e Google (Gemini). Parsing robusto com fallback no brain.ts.

**Context:** Hoje o brain-sdr sempre retorna `responseMode: "text"`. O system prompt contém o bloco `<response_format>` como referência comportamental (o LLM conhece os modos), mas sem um mecanismo de saída estruturada o LLM não consegue sinalizar `"audio"` quando o usuário pede. A solução correta é usar `response_format` (OpenAI) ou `generationConfig.responseMimeType` (Google) no nível da API — não instrução de prompt.

**Requirements:** TBD
**Plans:** 1/1 plans complete

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 18: Build and Publish Docker Image via DockGate

**Goal:** Criar o pipeline de CI/CD (GitHub Actions) que builda a imagem Docker do brain-sdr e publica via DockGate — o registry Docker auto-hospedado do projeto, com API sobre MinIO. Disparado por push de tag semver v*.*.*.
**Requirements**: DOCKER-BUILD-01, DOCKER-EXPORT-01, DOCKGATE-UPLOAD-01, DOCKGATE-PUBLISH-01
**Depends on:** Phase 17
**Plans:** 1 plan

Plans:

- [ ] 18-01-PLAN.md — Criar .github/workflows/publish-brain-sdr.yml com pipeline completo de build, export e publicação no DockGate
