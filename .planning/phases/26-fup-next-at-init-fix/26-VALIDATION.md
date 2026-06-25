---
phase: 26
slug: fup-next-at-init-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-25
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.x) |
| **Config file** | nenhum — bun detecta automaticamente |
| **Quick run command** | `bun test packages/core/src/__tests__/unit/fup/` |
| **Full suite command** | `bun test packages/core/` |
| **Estimated runtime** | ~5 seconds (suite de fup/) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/__tests__/unit/fup/`
- **After every plan wave:** Run `bun test packages/core/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 0 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | ⚠️ W0 (novos testes) | ⬜ pending |
| 26-01-02 | 01 | 1 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | ✅ (após W0) | ⬜ pending |
| 26-01-03 | 01 | 1 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/` | ✅ (após W0) | ⬜ pending |
| 26-01-04 | 01 | 1 | FUP-02 | — | N/A | manual | — | ✅ linha 222 fup-scheduler.ts | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` — adicionar testes para comportamento de `fupNextAt` no INSERT:
  - `upsertLead() com fupEnabled=true persiste fupNextAt como Date (não null)`
  - `upsertLead() com fupEnabled=false mantém fupNextAt=null`
  - `upsertLead() em UPDATE não altera fupNextAt existente`
  - `upsertLead() com intervals_seconds=[] mantém fupNextAt=null (guard)`

*Arquivo já existe (testa resetFup) — apenas novos casos serão adicionados.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Comment EVT-04 em fup-scheduler.ts documenta divergência de `event_id` | FUP-02 / D-07 | Comment de código não é verificável por suite | Ler linha ~222 de `packages/core/src/fup/fup-scheduler.ts` e confirmar que documenta `event_id = uniqueId:fup:step` como divergência intencional de `thread_id:tool_call_id` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
