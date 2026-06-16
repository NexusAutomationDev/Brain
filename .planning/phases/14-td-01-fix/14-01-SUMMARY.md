---
phase: 14-td-01-fix
plan: "01"
subsystem: brain-sdr/qualifier
tags: [pgbouncer, postgres, prepare-false, static-analysis, td-01]
dependency_graph:
  requires: []
  provides: [qualifier-pgbouncer-compat, PGB-TD01-test]
  affects: [apps/brain-sdr]
tech_stack:
  added: []
  patterns: [postgres.js prepare:false para PgBouncer transaction mode, static analysis via readFileSync + regex]
key_files:
  created: []
  modified:
    - apps/brain-sdr/src/qualifier.ts
    - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
decisions:
  - "prepare:false aplicado somente na conexao postgres.js em saveQualificationToMemories — PostgresSaver usa driver pg internamente e nao aceita esta opcao (D-03, fora do escopo de TD-01)"
  - "Comment D-03 documenta a limitacao do PostgresSaver para evitar confusao futura"
metrics:
  duration: "~8 minutos"
  completed: "2026-06-16"
  tasks_completed: 2
  files_modified: 2
---

# Phase 14 Plan 01: TD-01 — Correcao prepare:false em qualifier.ts Summary

**One-liner:** Adicionar `prepare: false` em postgres.js connection de `saveQualificationToMemories` e teste de análise estática PGB-TD01 para compatibilidade com PgBouncer transaction mode.

## What Was Built

Correcao do unico blocker de producao TD-01 antes das fases MCP e responseMode dinamico:

1. **qualifier.ts linha 28:** `postgres(dbUrl, { max: 1, prepare: false })` com comment inline PGB-TD01
2. **qualifier.ts linha 196:** Comment D-03 documentando que PostgresSaver usa driver pg internamente (nao aceita `prepare:false`) — limitacao reconhecida e fora do escopo de TD-01
3. **qualifier.unit.test.ts:** Novo describe `PGB-TD01: prepare: false em saveQualificationToMemories` com teste de analise estatica via regex (mesmo padrao de PGB-05 em migrate.test.ts)

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Adicionar prepare:false e comment D-03 em qualifier.ts | 086dff7 | apps/brain-sdr/src/qualifier.ts |
| 2 | Adicionar describe PGB-TD01 em qualifier.unit.test.ts | acc9c77 | apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts |

## Verification Results

```
bun test apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
10 pass
0 fail
20 expect() calls
```

Checklist de verificacao do plano:
- [x] `grep "prepare: false" qualifier.ts` — retorna linha 28 com `postgres(dbUrl, { max: 1, prepare: false })`
- [x] `grep "PGB-TD01" qualifier.ts` — retorna comment inline na linha 28
- [x] `grep "D-03" qualifier.ts` — retorna comment de documentacao na linha 196
- [x] `bun test qualifier.unit.test.ts` — 10/10 passando, zero falhas
- [x] Output contem describe "PGB-TD01: prepare: false em saveQualificationToMemories"

## Deviations from Plan

Nenhuma — plano executado exatamente como escrito.

## Known Stubs

Nenhum.

## Threat Flags

Nenhum novo surface identificado. As ameacas T-14-01 e T-14-02 documentadas no threat_model do plano permanecem com disposicao `accept` — sem alteracao de superficie de ataque.

## Self-Check: PASSED

- [x] apps/brain-sdr/src/qualifier.ts — modificado (linha 28 e 196)
- [x] apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts — modificado (describe PGB-TD01 ao final)
- [x] commit 086dff7 existe (fix qualifier.ts)
- [x] commit acc9c77 existe (test qualifier.unit.test.ts)
- [x] bun test: 10 pass, 0 fail
