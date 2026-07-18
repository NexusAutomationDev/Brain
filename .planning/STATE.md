---
gsd_state_version: 1.0
milestone: none
milestone_name: null
status: Milestone shipped — awaiting next milestone
last_updated: "2026-07-02T15:20:00.000Z"
last_activity: 2026-07-02
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

No active phase. v1.5 milestone complete and archived.

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

Last activity: 2026-07-18 - Completed quick task 260718-o64: compose do brain-sdr apontado para v1.6.1 (fix passive-declare do consumer RabbitMQ)
