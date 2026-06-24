---
phase: 24-tech-debt-cleanup
plan: "01"
subsystem: core/runner, core/leads
tags: [tech-debt, bug-fix, sigterm, fup, lead-service]
dependency_graph:
  requires: []
  provides: [WR-01, WR-02, WR-03]
  affects: [packages/core/src/runner/runner.ts, packages/core/src/leads/lead-service.ts]
tech_stack:
  added: []
  patterns: [process.off cleanup, null-field guard, TDD]
key_files:
  created: []
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
decisions:
  - "WR-03: _sigtermHandler como campo privado nullable — permite process.off() seguro em close() sem risco de double-remove"
  - "WR-01: log contém apenas brainType e hasFupUrl:true (nunca a URL) — alinha com padrão T-22-04 já estabelecido"
  - "WR-02: updatedAt: new Date() em resetFup() alinha com setFullpp() e setIaAtivada() — consistência de dados sem alterar semântica de fupEnabled (D-19)"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-24"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 24 Plan 01: Tech Debt WR-01 + WR-02 + WR-03 Summary

**One-liner:** Três correções cirúrgicas em BrainRunner e LeadService — warning operacional de checkpointer ausente, consistência de updatedAt em resetFup, e cleanup de SIGTERM listener para evitar MaxListenersExceededWarning.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | WR-01 + WR-03 — BrainRunner SIGTERM handler e warning de checkpointer | e048673 | packages/core/src/runner/runner.ts |
| 2 | WR-02 — updatedAt em resetFup() e teste atualizado | 6b16718 | packages/core/src/leads/lead-service.ts, packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts |

## What Was Built

### WR-01 — Warning quando FUP_WEBHOOK_URL configurado mas checkpointer null

Em `runner.ts` `init()`, adicionado `else if (fupWebhookUrl && !this.checkpointer)` imediatamente após o bloco de inicialização do FupScheduler. Sem esse log, um operador que configura `FUP_WEBHOOK_URL` mas esquece do checkpointer não recebe nenhum feedback — o FupScheduler simplesmente não inicia silenciosamente.

Log emite apenas `{ brainType, hasFupUrl: true }` — nunca a URL em si (alinhado com padrão T-22-04).

### WR-02 — updatedAt: new Date() em LeadService.resetFup()

`resetFup()` agora inclui `updatedAt: new Date()` no set payload, tornando-o consistente com `setFullpp()` e `setIaAtivada()`. O campo `fupEnabled` permanece intencionalmente ausente (D-19: lead continua elegível para novo ciclo FUP após responder).

Teste `lead-service-fup.test.ts` atualizado com `expect(setPayload!.updatedAt).toBeInstanceOf(Date)` — 3 testes GREEN.

### WR-03 — SIGTERM handler como campo privado com cleanup em close()

`_sigtermHandler` adicionado como campo privado nullable. Em `init()`, o handler é atribuído ao campo antes de ser passado a `process.on()`. Em `close()`, `process.off('SIGTERM', this._sigtermHandler)` remove o listener e seta o campo como `null`. Isso evita acúmulo de listeners (MaxListenersExceededWarning) em chamadas múltiplas de `init()` — relevante para testes e reinicializações.

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None.

## Threat Flags

None — todas as ameaças do threat model do plano foram mitigadas:
- T-24-01 (Information Disclosure): log contém apenas brainType e hasFupUrl:true, nunca a URL
- T-24-02 (DoS/listener leak): process.off() em close() elimina acúmulo de listeners
- T-24-03 (Tampering): updatedAt usa new Date() do servidor, sem input externo

## Self-Check: PASSED

- [x] `packages/core/src/runner/runner.ts` — modificado, commit e048673
- [x] `packages/core/src/leads/lead-service.ts` — modificado, commit 6b16718
- [x] `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` — modificado, commit 6b16718
- [x] 3 testes GREEN: `bun test lead-service-fup.test.ts` — 3 pass, 0 fail
- [x] Commits existem: e048673, 6b16718
