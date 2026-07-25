---
phase: quick-260725-g7b
plan: 01
subsystem: core/fup
status: complete
tags: [fup, lead-service, bugfix]
requires: [fupConfig, getNextValidSlot]
provides: [resetFup-rearm]
affects: [packages/core/src/leads/lead-service.ts, packages/core/src/runner/runner.ts]
tech-stack:
  added: []
  patterns: [drizzle-select-mirror-upsertLead, getNextValidSlot-business-hours-slot]
key-files:
  created: []
  modified:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
decisions:
  - "resetFup re-arma fup_next_at a partir de fup_config em vez de sempre setar NULL"
  - "fup_enabled nunca alterado por resetFup (D-19)"
metrics:
  duration: ~2m
  completed: 2026-07-25
---

# Quick Task 260725-g7b: Fix LeadService.resetFup to re-arm fup_next_at Summary

`LeadService.resetFup` agora RE-ARMA `fup_next_at` a partir de `fup_config` (próximo slot válido, step 0) quando o lead responde, em vez de setar `NULL` incondicionalmente — corrigindo o bug em que qualquer lead que falava com a IA ficava permanentemente excluído dos follow-ups (elegibilidade do `FupScheduler` exige `fup_next_at <= NOW()`).

## What Changed

- **`resetFup(uniqueId)` → `resetFup(uniqueId, brainType?)`**: nova assinatura espelhando o parâmetro opcional de `upsertLead`. Quando `brainType` é fornecido e existe `fup_config` ativo (`enabled===true && intervalsSeconds.length>0`), consulta `fup_config` com o mesmo padrão de select de `upsertLead` e recalcula `fupNextAt = getNextValidSlot(NOW()+intervalsSeconds[0]*1000, minHour, maxHour, allowedDays, timezone)`. Sem `brainType` / config ausente / disabled / intervals vazio → fallback `fupNextAt=null` (backward compatible).
- **`fup_enabled` continua ausente do `set{}`** em todos os caminhos (D-19).
- **Doc comment de `resetFup`** reescrito para explicar o re-arme + fallback, preservando menções a D-19, FUP-06 e WR-02.
- **`runner.ts` (call site)**: `resetFup(lead.uniqueId)` → `resetFup(lead.uniqueId, this.brain.brainType)`; comentário FUP-06/D-19 acima atualizado de "Cancelar FUPs / seta NULL" para "Re-armar o ciclo".
- **Testes**: novo `describe("LeadService.resetFup() — re-arme")` com mock combinado `{ select, update }`; cobre re-arme (Date futuro + step 0), fallback NULL (disabled / missing / intervals vazio) e preservação de `fup_enabled`. Testes pré-existentes de fallback NULL mantidos.
- **`fup-scheduler.ts` intocado** — caminho de último FUP (fup_enabled=false, ia_ativada=false) preservado (git diff vazio).

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Re-armar fup_next_at em resetFup a partir de fup_config | a593f34 | lead-service.ts, runner.ts |
| 2 | Testes unitários do re-arme de resetFup | 56c3a89 | lead-service-fup.test.ts |

## Verification

- `bunx tsc --noEmit -p packages/core/tsconfig.json` → EXIT 0 (sem erros)
- `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` → **12 pass / 0 fail**, 36 expect() calls
- `git diff HEAD -- packages/core/src/fup/fup-scheduler.ts` → vazio (scheduler intocado)

## Must-Haves (truths)

- Lead que respondeu e voltou a silenciar re-entra no ciclo de FUP do step 0 — ✅ (re-arme para slot futuro)
- resetFup com fup_config ativo re-arma fup_next_at para slot futuro não-nulo — ✅ (teste (a))
- resetFup sem fup_config (ou disabled) mantém fup_next_at=NULL — ✅ (testes (b), (b2), (c))
- resetFup nunca altera fup_enabled (D-19) — ✅ (teste (d) + inspeção)
- Caminho de último FUP no FupScheduler permanece intocado — ✅ (git diff vazio)

## Deviations from Plan

None — plan executed exactly as written. (O caso (b) foi dividido em (b) enabled=false e (b2) select vazio para cobrir ambos os sub-cenários de fallback missing; ambos previstos no plano.)

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: packages/core/src/leads/lead-service.ts
- FOUND: packages/core/src/runner/runner.ts
- FOUND: packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
- FOUND commit: a593f34
- FOUND commit: 56c3a89
