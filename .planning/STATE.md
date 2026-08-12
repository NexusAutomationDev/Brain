---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: Transferência de Lead entre Agentes + Seed por Brain
status: planning
last_updated: "2026-08-12T22:46:56.464Z"
last_activity: 2026-08-12
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-02 after v1.5 milestone shipped)

**Core value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base

**Current focus:** Nenhum — v1.5 shipped 2026-07-02. Rode `/gsd-new-milestone` para iniciar v1.6.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-08-12 — Milestone v1.6 started

## Milestone v1.5 Summary — SHIPPED 2026-07-02

| Phase | Plans | Status | Completed |
|-------|-------|--------|-----------|
| 27 Tech Debt Fixes | 3/3 | COMPLETE | 2026-06-30 |
| 28 Embedding SDK | 5/5 | COMPLETE | 2026-07-01 |
| 29 Brain Suporte Core | 3/3 | COMPLETE | 2026-07-01 |
| 30 Brain Suporte Docker | 3/3 | COMPLETE | 2026-07-01 |
| 31 Pre-Client Onboarding Hardening | 1/1 | COMPLETE | 2026-07-02 |
| 32 Code Quality Cleanup | 6/6 | COMPLETE | 2026-07-02 |

**140 commits | 158 files changed | +21.037 / -493 lines | ~3 days**

## Milestone v1.4 Summary — SHIPPED 2026-06-25

| Phase | Plans | Status | Completed |
|-------|-------|--------|-----------|
| 19 Database Foundation | 2/2 | COMPLETE | 2026-06-23 |
| 20 Tool Events | 2/2 | COMPLETE | 2026-06-23 |
| 21 RAG | 3/3 | COMPLETE | 2026-06-24 |
| 22 FUP Automático | 3/3 | COMPLETE | 2026-06-24 |
| 23 RAG Wiring Fix | 1/1 | COMPLETE | 2026-06-24 |
| 24 Tech Debt Cleanup | 3/3 | COMPLETE | 2026-06-24 |
| 25 FUP Activation Trigger | 3/3 | COMPLETE | 2026-06-25 |
| 26 FUP Next-At Init Fix | 1/1 | COMPLETE | 2026-06-25 |

**157 commits | 181 files changed | +24.233 / -12.268 lines | 3 days**

## Tech Debt

Ledger v1.5 zerado no ship (ver `milestones/v1.5-MILESTONE-AUDIT.md` e Phases 31-32). Nenhum item bloqueante em aberto.

## Accumulated Context

### Known Pitfalls (carry-forward)

- MCP transport must use `"streamable_http"` with underscore (not hyphen) — ValueError without clear message
- `prepare: false` required in all postgres.js connections (PgBouncer transaction mode)
- `bun:sql` has stuck-connection bug after constraint errors — use `postgres.js` driver
- `bun test`'s `mock.module()` is process-global — a mock registered in one test file can leak into unrelated test files when the whole package's suite runs together (fixed for `brain-runner.test.ts`/`factory.test.ts` in Phase 32; same class of bug remains open in `packages/observability` and other `packages/core` test files — see Pending Todos)

### Pending Todos

- Fix cross-test mock.module pollution in `packages/observability` (`server.test.ts` → `health-transport.test.ts`) and `packages/core` (`event-publisher.test.ts`, `lead-service-fup.test.ts`) full-suite runs — `.planning/todos/pending/2026-07-02-fix-cross-test-mock-module-pollution-in-full-suite-runs.md`

## Archived

- `.planning/milestones/v1.5-ROADMAP.md`
- `.planning/milestones/v1.5-REQUIREMENTS.md`
- `.planning/milestones/v1.5-MILESTONE-AUDIT.md`
- `.planning/milestones/v1.5-phases/` (Phases 27-32)
- `.planning/milestones/v1.4-ROADMAP.md`
- `.planning/milestones/v1.4-REQUIREMENTS.md`
- `.planning/milestones/v1.4-MILESTONE-AUDIT.md`

## Next Steps

Run `/gsd-new-milestone` to start v1.6.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260630-ssd | Melhorar a seção Git Commit Guidelines do CLAUDE.md (scope, breaking changes, formatação, idioma) | 2026-06-30 | 3647768 | [260630-ssd-melhorar-a-secao-git-commit-guidelines-d](./quick/260630-ssd-melhorar-a-secao-git-commit-guidelines-d/) |
| 260717-uz8 | docker-compose.yml para brain-sdr usando imagem local existente sem build | 2026-07-18 | d0f1791 | [260717-uz8-docker-compose-yml-para-brain-sdr-usando](./quick/260717-uz8-docker-compose-yml-para-brain-sdr-usando/) |
| 260717-wpk | Suporte halfvec para embeddings >2000 dims (Gemini/3072) — NÃO mergeado em master, ver branch `worktree-agent-a51d3dffce5d3b264` | 2026-07-18 | (branch, não mergeado) | [260717-wpk-corrigir-suporte-a-embeddings-de-alta-di](./quick/260717-wpk-corrigir-suporte-a-embeddings-de-alta-di/) |
| 260718-o64 | Bump compose do brain-sdr de v1.5→v1.6.1 para corrigir PRECONDITION_FAILED do RabbitMQ (v1.6.1 tem o fix passive-declare) | 2026-07-18 | da1a632 | [260718-o64-atualizar-o-deploy-do-brain-sdr-de-v1-6-](./quick/260718-o64-atualizar-o-deploy-do-brain-sdr-de-v1-6-/) |
| 260718-x2p | Bump compose do brain-sdr de v1.6.1→v1.6.2 (tag inédita força CI/CD a rebuildar imagem limpa; v1.6.1 no host estava stale, PRECONDITION_FAILED persistia) | 2026-07-18 | f77802d | [260718-x2p-bump-brain-sdr-compose-para-v1-6-2](./quick/260718-x2p-bump-brain-sdr-compose-para-v1-6-2/) |
| 260718-p7q | Consumer RabbitMQ tolerante a body sem content-type:application/json (parse Buffer/string antes do safeParse) — mensagens do n8n iam pra DLQ; imagem 1.6.2 recompilada com o fix e recarregada na VPS (mesma tag) | 2026-07-18 | (pendente) | [260718-p7q-brain-parse-body-sem-content-type-json](./quick/260718-p7q-brain-parse-body-sem-content-type-json/) |
| 260725-g7b | Fix LeadService.resetFup para RE-ARMAR fup_next_at a partir do fup_config (antes zerava pra NULL) — leads que respondem e voltam a silenciar reentram no ciclo de FUP; last-step deactivation intacta; +12 testes | 2026-07-25 | 56c3a89 | [260725-g7b-fix-leadservice-resetfup-to-re-arm-fup-n](./quick/260725-g7b-fix-leadservice-resetfup-to-re-arm-fup-n/) |
| 260725-gme | Migrar publish-brain-sdr.yml e publish-brain-support.yml do fluxo DockGate/MinIO para push direto no Docker Hub (docker.io/biellil/*), com docker/login-action e tags versão+latest | 2026-07-25 | 0f228de, cd8a0e3 | [260725-gme-migrar-workflows-github-actions-para-doc](./quick/260725-gme-migrar-workflows-github-actions-para-doc/) |
| 260725-h17 | Adicionar workflow_dispatch manual (input version obrigatório) aos workflows publish-brain-sdr.yml e publish-brain-support.yml, sem alterar o trigger push: tags: existente | 2026-07-25 | 90e3f1f, df8f8b8 | [260725-h17-adicionar-workflow-dispatch-manual-aos-w](./quick/260725-h17-adicionar-workflow-dispatch-manual-aos-w/) |
| 260728-tjb | Structured output no sub-agente de qualificação (schema Zod imposto pelo provider, sem parse manual); fallback de modelo estendido a withStructuredOutput em packages/ai; history fetched em nível info; LOG_LEVEL malformado deixa de derrubar o container (incidente `LOG_LEVEL==info`) | 2026-07-28 | a11c230, 8dfffe0, d40558e, b11e370 | [260728-tjb-enforce-structured-output-in-qualificati](./quick/260728-tjb-enforce-structured-output-in-qualificati/) |
| 260728-suj | Separar falha técnica de desqualificação real no qualifier do brain-sdr: qualificado passa a ser boolean \| null; null não grava em memories (ON CONFLICT sobrescrevia qualificação genuína) e não vira evento no webhook/RabbitMQ via isErrorToolResult em packages/core; +10 testes | 2026-07-28 | c7ed49b, 35f5390, 6eabe7d | [260728-suj-distinguish-qualification-failure-from-g](./quick/260728-suj-distinguish-qualification-failure-from-g/) |
| 260803-g4j | Endpoint de debug POST /debug/inject-message (X-Admin-Token, mesmo padrão de segurança do /reload-prompts) que chama BrainRunner.injectMessage() → compiledGraph.updateState() pra injetar uma AIMessage no thread do LangGraph sem rodar o LLM; funciona mesmo sem checkpoint prévio; +16 testes | 2026-08-03 | 8423284, beedaca, 79e80f0 | [260803-g4j-adicionar-endpoint-de-debug-para-injetar](./quick/260803-g4j-adicionar-endpoint-de-debug-para-injetar/) |

Last activity: 2026-08-03 - Completed quick task 260803-g4j: endpoint de debug para injetar mensagem da IA no thread via updateState
