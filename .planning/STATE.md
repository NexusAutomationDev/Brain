---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Embedding SDK + Brain Suporte + Tech Debt
status: Ready to plan
last_updated: "2026-06-30T23:30:21.958Z"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-29 after v1.5 milestone started)

**Core value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base

**Current focus:** v1.5 — Tech Debt + Embedding SDK + Brain Suporte

## Current Position

| Field | Value |
|-------|-------|
| Milestone | v1.5 Embedding SDK + Brain Suporte + Tech Debt |
| Phase | 27 — Tech Debt Fixes (not started) |
| Status | Roadmap created, ready to execute |
| Progress | 0/4 phases complete |

```
Phase 27 ░░░░░░░░░░░░░░░░ 0%  Tech Debt Fixes
Phase 28 ░░░░░░░░░░░░░░░░ 0%  Embedding SDK
Phase 29 ░░░░░░░░░░░░░░░░ 0%  Brain Suporte Core
Phase 30 ░░░░░░░░░░░░░░░░ 0%  Brain Suporte Docker
```

## v1.5 Phases

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 27 | Tech Debt Fixes | TECH-01, TECH-02, TECH-03 | Not started |
| 28 | Embedding SDK | EMBD-01, EMBD-02, EMBD-03, EMBD-04, EMBD-05 | Not started |
| 29 | Brain Suporte Core | SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, SUP-07, SUP-08 | Not started |
| 30 | Brain Suporte Docker | SUP-06 | Not started |

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

## Tech Debt (carry-over para v1.5)

- **TD-03** (Baixo): `BRAIN_TOOLS` whitelist inerte para tools bound diretamente em `buildGraph()` → TECH-01
- **D-16** (Baixo): `vector(1536)` hardcoded na migration → EMBD-03
- **FUP-02** human verification pendente → TECH-02
- **MEM-03** semantic write path (dead code) → EMBD-05
- **OBS-02** transport status ausente no GET /health → TECH-03

## Accumulated Context

### Decisions

- IEmbeddingProvider comes BEFORE Brain Suporte (SUP-04 depends on it)
- Brain Suporte Docker is its own phase (deploy boundary, independent Dockerfile validation)
- TECH-01/02/03 grouped in Phase 27 — small isolated fixes, no inter-dependencies

### Known Pitfalls (carry-forward from v1.3/v1.4)

- MCP transport must use `"streamable_http"` with underscore (not hyphen) — ValueError without clear message
- `prepare: false` required in all postgres.js connections (PgBouncer transaction mode)
- `bun:sql` has stuck-connection bug after constraint errors — use `postgres.js` driver

## Archived

- `.planning/milestones/v1.4-ROADMAP.md`
- `.planning/milestones/v1.4-REQUIREMENTS.md`
- `.planning/milestones/v1.4-MILESTONE-AUDIT.md`

## Next Steps

Run `/gsd-plan-phase 27` to plan Phase 27: Tech Debt Fixes.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260630-ssd | Melhorar a seção Git Commit Guidelines do CLAUDE.md (scope, breaking changes, formatação, idioma) | 2026-06-30 | 3647768 | [260630-ssd-melhorar-a-secao-git-commit-guidelines-d](./quick/260630-ssd-melhorar-a-secao-git-commit-guidelines-d/) |

Last activity: 2026-06-30 - Completed quick task 260630-ssd: Melhorar a seção Git Commit Guidelines do CLAUDE.md
