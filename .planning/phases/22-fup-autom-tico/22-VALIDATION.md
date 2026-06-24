---
phase: 22
slug: fup-autom-tico
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in) |
| **Config file** | none — bun test discovers `__tests__/**/*.test.ts` natively |
| **Quick run command** | `bun test packages/core/src/__tests__/unit/fup` |
| **Full suite command** | `bun test packages/core/src/__tests__/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/__tests__/unit/fup`
- **After every plan wave:** Run `bun test packages/core/src/__tests__/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 0 | FUP-01 | — | N/A | unit | `bun test packages/database` | ❌ W0 | ⬜ pending |
| 22-02-01 | 02 | 1 | FUP-01 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-02-02 | 02 | 1 | FUP-02 | — | SELECT FOR UPDATE SKIP LOCKED prevents double-send | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-02-03 | 02 | 1 | FUP-07 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-03-01 | 03 | 1 | FUP-03 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-03-02 | 03 | 1 | FUP-05 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-03-03 | 03 | 1 | FUP-08 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ❌ W0 | ⬜ pending |
| 22-04-01 | 04 | 2 | FUP-06 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` — stubs para FUP-01, FUP-02, FUP-07, FUP-08 e EVT-03 (D-16, D-17, D-18)
- [ ] `packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts` — stubs para FUP-07 (timezone/horário comercial)

*Existing bun test infrastructure covers all phase requirements — no new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| FUP POST real para FUP_WEBHOOK_URL | FUP-01 | Requer endpoint externo (Z-API/Twilio) | Configurar FUP_WEBHOOK_URL para endpoint de teste; disparar FUP; verificar payload recebido |
| Duas instâncias do Brain não enviam mesmo FUP | FUP-02 | Requer múltiplas instâncias em paralelo | Subir 2 instâncias apontando para mesmo DB; aguardar tick de FUP; verificar apenas 1 mensagem enviada |
| Chamada LLM one-shot gera mensagem personalizada | FUP-03 | Requer DB com prompt key='fup' e histórico de conversa real | Inserir prompt 'fup' no banco; criar lead com histórico; disparar tick do scheduler; verificar mensagem gerada |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
