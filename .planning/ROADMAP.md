# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)

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

## Backlog

### Phase 999.1: responseMode dinâmico via structured output multi-provider (BACKLOG)

**Goal:** Eliminar o hardcode `responseMode: "text"` no brain.ts — o LLM sinaliza o modo correto (text/audio/etc) via API de structured output do provider, não via instrução no system prompt. Suporte obrigatório para OpenAI e Google (Gemini). Parsing robusto com fallback no brain.ts.

**Context:** Hoje o brain-sdr sempre retorna `responseMode: "text"`. O system prompt contém o bloco `<response_format>` como referência comportamental (o LLM conhece os modos), mas sem um mecanismo de saída estruturada o LLM não consegue sinalizar `"audio"` quando o usuário pede. A solução correta é usar `response_format` (OpenAI) ou `generationConfig.responseMimeType` (Google) no nível da API — não instrução de prompt.

**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)
