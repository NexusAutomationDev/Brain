# Roadmap: Brain Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-06-13) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Brain SDR + Infraestrutura Produção** — Phases 5-9 (shipped 2026-06-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Output Parser + Tool Contracts** — Phases 10-13 (shipped 2026-06-15) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 MCP Integration + Dynamic responseMode** — Phases 14-17 (shipped 2026-06-16) — [archive](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 RAG + Eventos de Tools + FUP Automático** — Phases 19-26 (shipped 2026-06-25) — [archive](milestones/v1.4-ROADMAP.md)
- 🔄 **v1.5 Embedding SDK + Brain Suporte + Tech Debt** — Phases 27-32 (active)

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

### v1.5 Embedding SDK + Brain Suporte + Tech Debt (Phases 27-32)

- [x] **Phase 27: Tech Debt Fixes** — BRAIN_TOOLS buildGraph coverage + FUP-02 E2E test + /health transport status (completed 2026-06-30)
- [x] **Phase 28: Embedding SDK** — IEmbeddingProvider interface + OpenAI adapter + ENV-driven dimensions + semantic write path (completed 2026-07-01)
- [x] **Phase 29: Brain Suporte Core** — LangGraph graph + MCP tools + RAG obrigatório + transport + BrainOutput + leads + ToolsRegistry (completed 2026-07-01)
- [x] **Phase 30: Brain Suporte Docker** — Dockerfile multi-stage independente + validação end-to-end de deploy (completed 2026-07-01)
- [x] **Phase 31: Pre-Client Onboarding Hardening** — CI shell hygiene + respond tool guard + .env.example docs + migration warning comment (gap closure, from v1.5 audit tech debt; docker-compose port fix dropped — already committed pre-audit) (completed 2026-07-01)
- [x] **Phase 32: Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene** — resolve WR/IN findings from phases 27-30 + backfill SUMMARY frontmatter + fix test ordering/isolation issues (gap closure, from v1.5 audit tech debt) — 5/6 plans complete, gap-closure plan 32-06 added to close 2 verification gaps (see 32-VERIFICATION.md) (completed 2026-07-02)

## Phase Details

### Phase 27: Tech Debt Fixes
**Goal**: Tech debt acumulado do v1.4 está quitado — BRAIN_TOOLS cobre todas as tools, FUP tem teste E2E real e /health expõe status do transport
**Depends on**: Nothing (isolated fixes, no inter-dependencies)
**Requirements**: TECH-01, TECH-02, TECH-03
**Success Criteria** (what must be TRUE):
  1. Developer seta `BRAIN_TOOLS=qualify_lead` e a tool bound diretamente em `buildGraph()` é excluída do grafo
  2. `bun test` roda teste de integração do FupScheduler contra PostgreSQL real sem mock — scheduler processa lead elegível e publica evento
  3. `GET /health` retorna campo `transport` com status `connected` ou `disconnected` refletindo estado real da conexão

**Plans:** 3/3 plans complete

Plans:
- [x] 27-01-PLAN.md — BRAIN_TOOLS enabledTools: BrainBuildContext + ToolsRegistry getter + brain-sdr filter
- [x] 27-02-PLAN.md — FUP E2E integration test contra PostgreSQL real (LLM mockado)
- [x] 27-03-PLAN.md — Transport status no GET /health: ITransport.getStatus() + HealthCheckResult expandido

### Phase 28: Embedding SDK
**Goal**: `packages/embeddings` existe como abstração completa de provider — qualquer Brain configura modelo e dimensões via ENV sem tocar TypeScript
**Depends on**: Nothing (new package, no runtime dependencies on Phase 27)
**Requirements**: EMBD-01, EMBD-02, EMBD-03, EMBD-04, EMBD-05
**Success Criteria** (what must be TRUE):
  1. Developer implementa `IEmbeddingProvider` com `embed()`, `dimensions` e `providerName` e o Brain aceita sem modificação no core
  2. `OpenAIEmbeddingProvider` em `packages/embeddings` embeda textos via API OpenAI com modelo e dimensões configuráveis
  3. Migration cria coluna `vector(N)` onde N vem de `EMBEDDING_DIMENSIONS` ENV — mudar ENV e re-migrar gera coluna com nova dimensão sem erro
  4. BrainRunner chama `createEmbeddings()` via `IEmbeddingProvider` ao processar mensagem — escrita semântica deixa de ser dead code

**Plans:** 5/5 plans complete

Plans:
- [x] 28-01-PLAN.md — packages/embeddings: IEmbeddingProvider + OpenAIEmbeddingProvider + GeminiEmbeddingProvider + createEmbeddingProvider() (Wave 0)
- [x] 28-02-PLAN.md — Migration 0009: TRUNCATE + ALTER COLUMN TYPE vector(N) em embeddings/knowledge_chunks (Wave 1)
- [x] 28-03-PLAN.md — Wire IEmbeddingProvider em search-knowledge.ts/ingest.ts, delete packages/ai dead code (Wave 1)
- [x] 28-04-PLAN.md — BrainRunner DI: embeddingProvider em query-time/save-time + dimension fail-fast (Wave 2)
- [x] 28-05-PLAN.md — Batch re-embed tool: POST /api/v1/reembed (Wave 2)

### Phase 29: Brain Suporte Core
**Goal**: `apps/brain-support` processa mensagens de suporte end-to-end — RAG estruturalmente sempre ativo, `pause_session`/`finish_conversation` nativas em `buildGraph()` (D-02), histórico persistente e saída estruturada validada pelo SDK
**Depends on**: Phase 28 (IEmbeddingProvider para SUP-04)
**Requirements**: SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-07, SUP-08
**Success Criteria** (what must be TRUE):
  1. Brain Suporte recebe mensagem via webhook (`TRANSPORT=webhook`) e via RabbitMQ (`TRANSPORT=rabbitmq`) e produz resposta sem alterar código
  2. Grafo sempre inclui `search_knowledge` no `ToolNode` — nenhuma ENV ou flag pode desativá-la
  3. Tools de gestão (`pause_session`, `finish_conversation`) são closures nativas criadas em `buildGraph()`, sem equivalente de `qualify_lead` (D-01/D-02) — mecanismo de MCP dinâmico genérico do core continua disponível, herdado sem trabalho adicional (D-03)
  4. Brain Suporte usa `IEmbeddingProvider` com modelo e dimensões independentes do Brain SDR — alterar `EMBEDDING_MODEL` de um não afeta o outro
  5. Resposta do Brain Suporte é `BrainOutput` válido (`fullResponse`, `responseMode`) — BrainRunner lança `BrainOutputValidationError` para saídas inválidas
  6. Gate `ia_ativada` bloqueia processamento silenciosamente; histórico de conversa por lead é recuperado do PostgresSaver via `thread_id = lead.uniqueId`
  7. `ToolsRegistry.registerBrainType("support", ...)` existe — habilitar tools por tipo funciona

**Plans:** 3/3 plans complete

Plans:
- [x] 29-01-PLAN.md — apps/brain-support: supportBrain (buildGraph com pause_session/finish_conversation nativas + search_knowledge sempre-on) + index.ts + server.ts
- [x] 29-02-PLAN.md — Migration 0010 (seed prompt 'system' para brain_type='support') + .env.example + testes de ToolsRegistry/server

### Phase 30: Brain Suporte Docker
**Goal**: `apps/brain-support` tem imagem Docker independente que sobe, migra e atende mensagens — pronto para entrega a clientes
**Depends on**: Phase 29 (Brain Suporte Core completo)
**Requirements**: SUP-06
**Success Criteria** (what must be TRUE):
  1. `docker build -f apps/brain-support/Dockerfile .` conclui sem erro — imagem multi-stage funcional
  2. Container sobe, roda `runMigrations()` com advisory lock e expõe `GET /health` com status `ok`
  3. Container processa mensagem de teste via webhook e retorna `BrainOutput` válido sem depender de arquivos do brain-sdr

**Plans:** 3/3 plans complete

Plans:
- [x] 30-01-PLAN.md — Root .dockerignore (all Brains) + fix packages/embeddings gap in apps/brain-sdr/Dockerfile (D-03/D-06)
- [x] 30-02-PLAN.md — apps/brain-support/Dockerfile (multi-stage, embeddings included) + docker-compose.yml (D-01/D-02/D-04/D-05/D-09)
- [x] 30-03-PLAN.md — .github/workflows/publish-brain-support.yml (D-10/D-11/D-12) + real e2e validation round-trip (D-07/D-08)

### Phase 31: Pre-Client Onboarding Hardening
**Goal**: Os itens de tech debt marcados pela auditoria v1.5 como "worth a follow-up before onboarding a real client" estão fechados
**Depends on**: Phase 30 (Brain Suporte Docker completo)
**Requirements**: TECH-04, TECH-05
**Gap Closure**: Fecha achados do `tech_debt` block em `.planning/v1.5-MILESTONE-AUDIT.md` (integration finding + tech debt highlights)
**Scope correction (2026-07-01, found during /gsd-discuss-phase 31 codebase scout)**: o fix de porta em `apps/brain-support/docker-compose.yml` (3002→3003) que a auditoria reportou como "staged but not committed" já estava commitado em `3abf253` — antes do próprio commit do relatório de auditoria (`9768107`). Removido do escopo desta fase; nenhuma tarefa criada para ele.
**Success Criteria** (what must be TRUE):
  1. `.github/workflows/publish-brain-support.yml` e `publish-brain-sdr.yml` fazem quote de `$RESPONSE` no pipe `jq` e `exit 1` com a resposta bruta impressa se `jq -r .url` retornar vazio ou `"null"`
  2. Tool `respond` tem a mesma proteção de append-after-filter que `search_knowledge` já tem, em `brain-sdr` e `brain-support` — `BRAIN_TOOLS` mal configurado não degrada silenciosamente toda resposta
  3. `apps/brain-sdr/.env.example` documenta `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`
  4. Migration `0009_embedding_dimensions_fix.sql` tem comentário inline avisando que `vector(1536)` é hardcoded para OpenAI e requer `TRUNCATE` manual ao regenerar com outra `EMBEDDING_DIMENSIONS`

**Plans:** 1/1 plans complete

Plans:
- [x] 31-01-PLAN.md — CI shell hygiene (quote $RESPONSE, validate URL) + respond tool append-after-filter (brain-sdr + brain-support) + .env.example embedding docs + migration inline comment

### Phase 32: Code Quality Cleanup — Accumulated Warnings & Test/Doc Hygiene
**Goal**: Achados warning/info de code review acumulados nas fases 27-30 estão resolvidos e as lacunas de documentação/teste estão preenchidas, zerando o ledger de tech debt do v1.5
**Depends on**: Phase 31
**Requirements**: TECH-06
**Gap Closure**: Fecha os itens restantes do `tech_debt` block em `.planning/v1.5-MILESTONE-AUDIT.md` (warnings + info-level findings, phases 27-30)
**Scope correction (2026-07-02, found during /gsd-discuss-phase 32 codebase scout, confirmed during /gsd-plan-phase 32)**: dois achados da Phase 27 não reproduzem no código atual — "branch morto 503/500" (`performHealthCheck()`/`createHealthApp()` já mapeiam `error`→500 e `degraded`/db-failure→503 corretamente) e "`as any` para `RunnableConfig`" (`pause-session.ts`/`finish-conversation.ts` já usam o tipo `RunnableConfig` próprio, sem cast). Documentados como já-resolvidos em `32-01-PLAN.md`, sem task de fix. Também por decisão do usuário (32-CONTEXT.md D-05/D-10): `getEmbeddingProvider()` NÃO recebe caminho de invalidação — permanece singleton de vida do processo, com a justificativa documentada inline (ENVs de embedding são fixas por container, sem caso de uso de reload em runtime neste modelo de deployment).
**Success Criteria** (what must be TRUE):
  1. Achados WR/IN da Phase 27 resolvidos: vazamento de handler SIGTERM em `BrainRunner.init()`, colisão de chave no retry map do RabbitMQ, `WebhookTransport.getStatus()` reflete estado real após `stop()` (branch morto 503/500 e `as any` de `RunnableConfig` — confirmados já-resolvidos, ver scope correction acima)
  2. Achados WR/IN da Phase 28 resolvidos: comentário `ingest.ts` corrigido, `LazyEmbeddingProvider` com placeholder documentado (não removido — ver 32-CONTEXT.md D-04), `reembed.ts` com limite de páginas, `runner.ts` com tratamento defensivo para dimension-mismatch, assunção de `atttypmod` documentada, `search-knowledge.ts` trunca conteúdo de chunk, `EMBEDDING_DIMENSIONS` validado contra o valor fixo do Gemini (3072), checagem duplicada de `DATABASE_URL` em `_compileGraph()` removida
  3. Achados IN da Phase 29 resolvidos: `RESERVED_TOOL_NAMES` derivado das instâncias de tool reais, `getEmbeddingProvider()` com rationale de singleton documentado (sem caminho de invalidação — ver scope correction acima), type-guard de mensagem AI unificado entre `routeAfterLlm`/`respond`
  4. Naming da SUP-08 alinhado entre requisito e código (`ToolsRegistry.registerBrainType` vs `toolsRegistry.enableTool`)
  5. Frontmatter `requirements-completed` retroativo em `27-02`, `27-03`, `29-01`, `29-02`; `fup-e2e.test.ts` sem dependência de ordem entre testes; causa raiz do cross-pollution de `mock.module` entre `brain-runner.test.ts` e `factory.test.ts` investigada e corrigida (confirmado reproduzindo — 3 falhas quando os dois arquivos rodam juntos — e corrigido)

**Plans:** 6/6 plans complete

Plans:
- [x] 32-01-PLAN.md — Runtime lifecycle hardening: SIGTERM idempotency, RabbitMQ retry-key collision, WebhookTransport stale status, atttypmod defensive query + doc, duplicate DATABASE_URL check removal, mock.module cross-pollution fix (Wave 1)
- [x] 32-02-PLAN.md — RAG/embeddings hardening: reembed.ts MAX_PAGES cap, ingest.ts comment fix, search-knowledge.ts content truncation, Gemini EMBEDDING_DIMENSIONS validation (Wave 1)
- [x] 32-03-PLAN.md — Shared abstractions: hasToolCall/getFirstToolCallName type-guards, RESERVED_TOOL_NAMES derivation, LazyEmbeddingProvider/getEmbeddingProvider() doc (Wave 1)
- [x] 32-04-PLAN.md — Test hygiene: fup-e2e.test.ts independent tests, REQUIREMENTS.md SUP-08 naming alignment (Wave 1)
- [x] 32-05-PLAN.md — SUMMARY.md requirements-completed frontmatter backfill (27-02, 27-03, 29-01, 29-02) (Wave 1)
- [x] 32-06-PLAN.md — Gap closure: pin EMBEDDING_DIMENSIONS in brain-runner.test.ts (32-VERIFICATION.md Gap 1) + mark TECH-06 complete in REQUIREMENTS.md (Gap 2) (Wave 1)

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
