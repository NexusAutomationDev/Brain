---
phase: 26-fup-next-at-init-fix
plan: 01
subsystem: core/leads
tags: [fup, lead-service, scheduler, bug-fix, tdd]
dependency_graph:
  requires: [Phase 25 - FUP Activation Trigger]
  provides: [FUP-02 — fupNextAt populado no INSERT, scheduler pode processar leads novos]
  affects: [packages/core/src/leads/lead-service.ts, packages/core/src/fup/fup-scheduler.ts]
tech_stack:
  added: []
  patterns:
    - Import direto de getNextValidSlot de fup-scheduler.ts (D-05 Opção A)
    - Guard defensivo intervalsSeconds.length > 0 contra array vazio (Pitfall 2)
    - TDD RED → GREEN para novo comportamento de fupNextAt no INSERT
key_files:
  created: []
  modified:
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
    - packages/core/src/leads/__tests__/lead-service.test.ts
    - packages/core/src/fup/fup-scheduler.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "D-05 Opção A: import direto de getNextValidSlot de fup-scheduler.ts (sem extração para scheduling-utils.ts)"
  - "Guard Pitfall 2: intervalsSeconds.length > 0 antes de calcular fupNextAt"
  - "fupNextAt ausente do set{} de onConflictDoUpdate — INSERT-only por design (D-01/D-03)"
metrics:
  duration: ~20min
  completed: 2026-06-25
  tasks_completed: 3
  files_changed: 5
---

# Phase 26 Plan 01: FUP Next-At Init Fix Summary

**One-liner:** `upsertLead()` calcula e persiste `fupNextAt = getNextValidSlot(NOW() + intervals_seconds[0], ...)` no INSERT quando `fupEnabled=true`, fechando o gap que impedia o FupScheduler de processar leads novos.

## O que foi implementado

### Problema fechado

Phase 25 ativou `fup_enabled = true` no INSERT de leads novos, mas deixou `fup_next_at = NULL`. O `FupScheduler._tick()` tem WHERE clause `AND l.fup_next_at <= NOW()` — NULL nunca satisfaz essa condição no PostgreSQL, portanto leads criados com FUP ativado jamais eram processados pelo scheduler.

### Mudanças realizadas

**1. `packages/core/src/leads/lead-service.ts`**

- Import de `getNextValidSlot` de `../fup/fup-scheduler.js` (D-05 Opção A — import direto)
- Variável `fupNextAt: Date | null = null` adicionada ao escopo de `upsertLead()`
- Query de `fup_config` expandida para incluir `intervalsSeconds`, `minHour`, `maxHour`, `allowedDays`, `timezone` (antes buscava apenas `enabled`)
- Guard defensivo: `config.intervalsSeconds.length > 0` previne cálculo com array vazio (Pitfall 2)
- Quando `fupEnabled = true`: `fupNextAt = getNextValidSlot(new Date(Date.now() + intervals_seconds[0] * 1000), minHour, maxHour, allowedDays, timezone)`
- `fupNextAt` adicionado ao `values()` do INSERT — ausente do `set{}` do onConflictDoUpdate (INSERT-only por design)
- JSDoc atualizado com nota da Phase 26 D-01

**2. `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts`**

Novo describe block `"LeadService.upsertLead() — fupNextAt no INSERT"` com 4 testes:
- Test 1: INSERT com `fupEnabled=true` persiste `fupNextAt` como `Date` (não null)
- Test 2: INSERT sem `fup_config` mantém `fupNextAt=null`
- Test 3: INSERT com `intervals_seconds=[]` mantém `fupNextAt=null` (guard Pitfall 2)
- Test 4: UPDATE (lead existente) — `fupEnabled=false` e `fupNextAt=null` em `values()` (defaults)

Helper `makeUpsertDbMock` com `selectCallCount` para distinguir o primeiro SELECT (lead existente) do segundo (fup_config).

**3. `packages/core/src/fup/fup-scheduler.ts`**

Code comment na linha 222 expandido de `// D-17: idempotente por step` para:
```
// D-17: formato diverge intencionalmente de EVT-04 (thread_id:tool_call_id).
// FUP events não têm tool_call_id — identificados por uniqueId:fup:step.
// Idempotente: mesmo step re-enviado produz o mesmo event_id.
```

**4. `.planning/REQUIREMENTS.md`**

EVT-04 atualizado com nota de exceção: `**Exceção FUP:** eventos de FUP usam event_id = ${lead.uniqueId}:fup:${fup_step} — FUP events não têm tool_call_id (D-17 da Phase 22, decisão intencional).`

## Decisões

| Decisão | Escolha | Rationale |
|---------|---------|-----------|
| D-05: compartilhamento de getNextValidSlot | Opção A — import direto de fup-scheduler.ts | Função já exportada, sem novo arquivo, risco mínimo de regressão; sem ciclo confirmado via grep |
| Guard Pitfall 2 | `intervalsSeconds.length > 0` antes de calcular | Schema permite array NOT NULL mas sem checagem de length; previne `NaN` timestamp |
| fupNextAt no set{} | Ausente intencionalmente | D-01/D-03: fupNextAt é INSERT-only; UPDATE preserva valor existente |

## Resultado dos testes

```
bun test packages/core/src/__tests__/unit/fup/
24 pass, 0 fail (suite FUP completa: business hours + scheduler + lead-service-fup)

bun test packages/core/src/leads/__tests__/lead-service.test.ts
13 pass, 0 fail (suite lead-service completa, incluindo Phase 25 FUP activation)
```

Testes pré-existentes com falha: 5 erros de `Cannot find package 'rabbitmq-client'` — problema pré-existente de pacote não instalado no worktree, não introduzido por esta fase (confirmado via stash).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regressão nos testes da Phase 25 após expandir query fup_config**

- **Encontrado durante:** Task 2 (GREEN) — ao rodar `bun test packages/core/`
- **Problema:** Testes da Phase 25 em `lead-service.test.ts` mockavam `fup_config` retornando apenas `{ enabled: true/false }`. A Phase 26 expandiu a query para incluir `intervalsSeconds`, `minHour`, `maxHour`, `allowedDays`, `timezone`. O guard `config.intervalsSeconds.length > 0` acessava `undefined.length` com o mock antigo — TypeError silencioso causava `fupEnabled = false` mesmo com `enabled: true`
- **Fix:** Atualizar `mockLimit4.mockImplementationOnce` nos 2 testes afetados para retornar objeto completo com campos de business hours (`intervalsSeconds: [3600]`, `minHour: 8`, etc.)
- **Arquivos modificados:** `packages/core/src/leads/__tests__/lead-service.test.ts`
- **Commit:** `444b6c1`

## Known Limitation (deferred)

Segundo ciclo de FUP: após `resetFup()`, o lead fica com `fup_enabled = true` mas `fup_next_at = NULL`. O scheduler não processa novamente até que `fupNextAt` seja repopulado. Esta limitação está documentada no `26-CONTEXT.md` como explicitamente fora do escopo desta fase — o primeiro ciclo (INSERT) está corrigido e é o requisito principal de FUP-02.

## FUP-02 Status

**COMPLETE** — leads criados com FUP ativado agora têm `fup_next_at` populado no INSERT. O FupScheduler processa esses leads no próximo tick após `fup_next_at <= NOW()` sem intervenção manual.

## Commits

| Task | Commit | Descrição |
|------|--------|-----------|
| Task 1 RED | `03491a1` | ✅ test(26-01): add failing tests for fupNextAt INSERT behavior |
| Task 2 GREEN | `ec6d72c` | ✨ feat(26-01): implement fupNextAt calculation in upsertLead() INSERT |
| Task 3 | `8a658d5` | 📝 docs(26-01): expand EVT-04 exception comment and update REQUIREMENTS.md |
| Rule 1 fix | `444b6c1` | 🐛 fix(26-01): update Phase 25 test mocks for expanded fup_config fields |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/core/src/leads/lead-service.ts | FOUND |
| packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts | FOUND |
| packages/core/src/fup/fup-scheduler.ts | FOUND |
| .planning/REQUIREMENTS.md | FOUND |
| .planning/phases/26-fup-next-at-init-fix/26-01-SUMMARY.md | FOUND |
| commit 03491a1 (RED tests) | FOUND |
| commit ec6d72c (GREEN implementation) | FOUND |
| commit 8a658d5 (docs EVT-04) | FOUND |
| commit 444b6c1 (Rule 1 fix) | FOUND |
