# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 MCP Integration + Dynamic responseMode** — Phases 14-17 (in progress)

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

### 🚧 v1.3 MCP Integration + Dynamic responseMode (In Progress)

**Milestone Goal:** Conectar Brains a ferramentas externas via MCP e deixar o LLM controlar o formato de resposta dinamicamente.

- [x] **Phase 14: TD-01 Fix** — qualifier.ts com prepare: false, elimina blocker de produção com PgBouncer (completed 2026-06-16)
- [ ] **Phase 15: MCP Integration** — Brain conecta a servidor MCP externo, registra tools no startup, SIGTERM limpo
- [ ] **Phase 16: Dynamic responseMode** — LLM escolhe responseMode via schema-as-tool, sem hardcode, multi-provider

## Phase Details

### Phase 14: TD-01 Fix
**Goal**: qualifier.ts opera com prepare: false, compatível com PgBouncer transaction mode em produção
**Depends on**: Phase 13
**Requirements**: TD-01
**Success Criteria** (what must be TRUE):
  1. qualifier.ts abre conexão postgres com `prepare: false` — mesma configuração do TenantPoolManager
  2. Sub-agente de qualificação executa sem erro em ambiente com PgBouncer transaction mode
  3. Testes existentes do qualifier continuam passando após a mudança
**Plans**: 1 plan

Plans:
- [x] 14-01-PLAN.md — Adicionar prepare:false em qualifier.ts + static analysis test PGB-TD01

### Phase 15: MCP Integration
**Goal**: Brain SDR conecta a servidor MCP externo via ENV, usa MCP tools como LangGraph tools nativas, e encerra conexão de forma limpa no SIGTERM
**Depends on**: Phase 14
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. Com MCP_URL e MCP_TOOLS definidos, Brain lista e usa MCP tools no grafo junto com tools nativas (qualify_lead, pause_session, finish_conversation)
  2. Com MCP server inacessível no startup, Brain inicializa normalmente com zero MCP tools e log de warn — tools nativas permanecem intactas
  3. Timeout ou erro em MCP tool durante execução gera ToolMessage de erro no histórico — thread_id do lead não fica corrompido em chamadas subsequentes
  4. SIGTERM encerra processo Bun sem hang — `runner.close()` fecha MultiServerMCPClient antes do `process.exit(0)`
  5. Sem MCP_URL definido, BrainRunner ignora MCP completamente — comportamento idêntico ao v1.2
**Plans**: TBD
**UI hint**: no

Plans:
- [ ] TBD

### Phase 16: Dynamic responseMode
**Goal**: LLM escolhe responseMode (text/audio/image) dinamicamente via schema-as-tool — sem valor hardcoded no código, funcionando em OpenAI e Anthropic
**Depends on**: Phase 15
**Requirements**: RESP-01, RESP-02, RESP-03
**Success Criteria** (what must be TRUE):
  1. LLM retorna responseMode "audio" ou "image" quando o contexto da conversa exige — sem instrução explícita de prompt para cada valor
  2. fullResponse contém o texto da resposta sem alteração pelo mecanismo de seleção de formato
  3. Brain SDR com provider OpenAI e com provider Anthropic produz BrainOutput válido com responseMode correto — mesmo código de grafo, sem branching por provider
  4. Remover `responseMode: "text"` hardcoded do nó llm não quebra nenhum teste existente — BrainOutputValidationError não é disparado em fluxo normal
**Plans**: TBD

Plans:
- [ ] TBD

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
| 14. TD-01 Fix | v1.3 | 1/1 | Complete    | 2026-06-16 |
| 15. MCP Integration | v1.3 | 0/? | Not started | - |
| 16. Dynamic responseMode | v1.3 | 0/? | Not started | - |
| 17. Expor contagem de tokens gastos | v1.3 | 0/? | Not started | - |

## Backlog

### Phase 999.1: responseMode dinâmico via structured output multi-provider (BACKLOG)

**Goal:** Eliminar o hardcode `responseMode: "text"` no brain.ts — o LLM sinaliza o modo correto (text/audio/etc) via API de structured output do provider, não via instrução no system prompt. Suporte obrigatório para OpenAI e Google (Gemini). Parsing robusto com fallback no brain.ts.

**Context:** Hoje o brain-sdr sempre retorna `responseMode: "text"`. O system prompt contém o bloco `<response_format>` como referência comportamental (o LLM conhece os modos), mas sem um mecanismo de saída estruturada o LLM não consegue sinalizar `"audio"` quando o usuário pede. A solução correta é usar `response_format` (OpenAI) ou `generationConfig.responseMimeType` (Google) no nível da API — não instrução de prompt.

**Requirements:** TBD
**Plans:** 1/1 plans complete

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 17: Expor contagem de tokens gastos na resposta da API REST e RabbitMQ

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 16
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 17 to break down)
