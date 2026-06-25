---
phase: 26
slug: fup-next-at-init-fix
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-25
audited: 2026-06-25
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
| 26-01-01 | 01 | 0 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | ✅ | ✅ green |
| 26-01-02 | 01 | 1 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | ✅ | ✅ green |
| 26-01-03 | 01 | 1 | FUP-02 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup/` | ✅ | ✅ green |
| 26-01-04 | 01 | 1 | FUP-02 | — | N/A | manual | — | ✅ linha 223 fup-scheduler.ts | ✅ verified |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` — testes para comportamento de `fupNextAt` no INSERT:
  - [x] `upsertLead() com fupEnabled=true persiste fupNextAt como Date (não null)`
  - [x] `upsertLead() com fupEnabled=false mantém fupNextAt=null`
  - [x] `upsertLead() em UPDATE não altera fupNextAt existente`
  - [x] `upsertLead() com intervals_seconds=[] mantém fupNextAt=null (guard)`

*4 testes adicionados em describe "LeadService.upsertLead() — fupNextAt no INSERT".*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Verified |
|----------|-------------|------------|-------------------|----------|
| Comment EVT-04 em fup-scheduler.ts documenta divergência de `event_id` | FUP-02 / D-07 | Comment de código não é verificável por suite | Ler linha ~222 de `packages/core/src/fup/fup-scheduler.ts` e confirmar que documenta `event_id = uniqueId:fup:step` como divergência intencional de `thread_id:tool_call_id` | ✅ confirmado (linha 223) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ APPROVED — 2026-06-25

---

## Validation Audit 2026-06-25

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Tasks COVERED | 3 (automated) |
| Tasks MANUAL | 1 |
| Test suite result | 24 pass, 0 fail |
