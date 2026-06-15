# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Output Parser + Tool Contracts** — Phases 10-12 (in progress)

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

### 🚧 v1.2 Output Parser + Tool Contracts (In Progress)

**Milestone Goal:** Padronizar o contrato de saída dos Brains e o sistema de tools — toda resposta é estruturada, todo conjunto de tools é configurável via ENV.

- [x] **Phase 10: Output Parser SDK** — Schema JSON estruturado definido e aplicado no core; todos os Brains retornam `BrainOutput` em vez de string plana (gap closure em andamento) (completed 2026-06-15)
- [x] **Phase 11: Tool Contracts SDK** — Whitelist de tools via `BRAIN_TOOLS` ENV e tools padrão (`pause_session`, `finish_conversation`) disponíveis no SDK (completed 2026-06-15)
- [ ] **Phase 12: Brain SDR Integration** — Brain SDR migrado para Output Parser e com `pause_session`/`finish_conversation` habilitadas por padrão

## Phase Details

### Phase 10: Output Parser SDK
**Goal**: O SDK define e aplica um contrato de saída estruturado — todo Brain retorna `BrainOutput` com `fullResponse` e `responseMode` obrigatórios; string plana deixa de ser output válido
**Depends on**: Phase 9 (v1.1 complete)
**Requirements**: PARSER-01, PARSER-02
**Success Criteria** (what must be TRUE):
  1. `packages/core` exporta `BrainOutputSchema` (Zod) e o tipo `BrainOutput` com `fullResponse` (string obrigatória), `responseMode` (obrigatório), `mediaType`/`mediaUrl` (condicionalmente obrigatórios entre si)
  2. `BrainRunner.run()` rejeita (lança erro) qualquer saída do LangGraph que não valide contra `BrainOutputSchema`
  3. O contrato da interface `IBrain.run()` retorna `BrainOutput` em vez de `string` — qualquer Brain que retorne string não compila
  4. brain-echo compila e seus testes passam com o novo contrato de saída
**Plans**: 4 plans
Plans:
- [x] 10-01-PLAN.md — BrainOutput type em shared, BrainOutputSchema em core, testes unitários do schema
- [x] 10-02-PLAN.md — BrainStateAnnotation com brainOutput, BrainRunner.run() novo retorno e validação
- [x] 10-03-PLAN.md — brain-echo migrado para setar brainOutput, IBrainRunnerLike e handler.ts atualizados
- [x] 10-04-PLAN.md — [gap closure] remover .js stale de packages/shared/src/, reconstruir dist/, verificar 17 testes do runner

### Phase 11: Tool Contracts SDK
**Goal**: O SDK suporta controle de tools via ENV e disponibiliza `pause_session` e `finish_conversation` como tools padrão que qualquer Brain pode habilitar
**Depends on**: Phase 10
**Requirements**: TOOLS-ENV-01, TOOLS-ENV-02, TOOLS-STD-01, TOOLS-STD-02
**Success Criteria** (what must be TRUE):
  1. Quando `BRAIN_TOOLS=pause_session,finish_conversation` está no ENV, apenas essas tools são habilitadas no ToolsRegistry — `enableTool()` de tools fora da whitelist é silenciosamente ignorado
  2. Quando `BRAIN_TOOLS` está ausente, o comportamento de `enableTool()` é idêntico ao atual — nenhum Brain existente quebra
  3. `pause_session` está disponível em `packages/core/tools`: quando invocada, altera `leads.fullpp` para `false` no banco do tenant ativo
  4. `finish_conversation` está disponível em `packages/core/tools`: quando invocada, altera `leads.ia_ativada` para `false` e `leads.fullpp` para `false` no banco do tenant ativo
**Plans**: 2 plans
Plans:
- [x] 11-01-PLAN.md — Testes Wave 0 + BrainBuildContext sql? + ToolsRegistry BRAIN_TOOLS guard + LeadService setFullpp/setIaAtivada
- [x] 11-02-PLAN.md — Factories createPauseSessionTool e createFinishConversationTool + BrainRunner sql injection + barrel exports

### Phase 12: Brain SDR Integration
**Goal**: Brain SDR consome o Output Parser e habilita `pause_session` e `finish_conversation` por padrão — primeiro Brain a usar o contrato completo de v1.2
**Depends on**: Phase 11
**Requirements**: PARSER-03, TOOLS-STD-03
**Success Criteria** (what must be TRUE):
  1. Brain SDR retorna `BrainOutput` estruturado em todas as respostas — webhook e RabbitMQ entregam JSON com `fullResponse` e `responseMode` (não mais string plana)
  2. Brain SDR tem `pause_session` e `finish_conversation` registradas via `enableTool()` no Brain SDR init — ambas aparecem no grafo LangGraph como ferramentas disponíveis
  3. Um POST ao `/api/v1/webhook` do brain-sdr retorna body JSON com os campos do `BrainOutput` validáveis por schema
  4. `turbo run build` e `turbo run lint` passam em todos os pacotes incluindo brain-sdr após a migração
**Plans**: 2 plans
Plans:
- [ ] 12-01-PLAN.md — brain.ts migrado: 3 tools bound + nó llm com brainOutput; index.ts: 2 enableTool(); brain.test.ts: cobertura 3 tools; package.json: lint script
- [ ] 12-02-PLAN.md — handler.ts: resposta { fullResponse, responseMode } sem reply; handler.test.ts: assertions do novo contrato

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
| 10. Output Parser SDK | v1.2 | 5/5 | Complete    | 2026-06-15 |
| 11. Tool Contracts SDK | v1.2 | 2/1 | Complete    | 2026-06-15 |
| 12. Brain SDR Integration | v1.2 | 0/2 | Not started | - |
