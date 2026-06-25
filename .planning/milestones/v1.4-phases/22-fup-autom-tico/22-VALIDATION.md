---
phase: 22
slug: fup-autom-tico
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
audited: 2026-06-24
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
| 22-01-01 | 01 | 0 | FUP-01 | — | N/A | unit | `bun test packages/database` | ✅ | ✅ green |
| 22-02-01 | 02 | 1 | FUP-01 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-02-02 | 02 | 1 | FUP-02 | — | SELECT FOR UPDATE SKIP LOCKED prevents double-send | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-02-03 | 02 | 1 | FUP-07 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-03-01 | 03 | 1 | FUP-03 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-03-02 | 03 | 1 | FUP-05 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-03-03 | 03 | 1 | FUP-08 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/fup` | ✅ | ✅ green |
| 22-04-01 | 03 | 2 | FUP-06 | — | N/A | unit | `bun test packages/core/src/__tests__/unit/` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` — 10 testes: FUP-01, FUP-02, FUP-03, FUP-05, FUP-08, EVT-03 (D-16, D-17, D-18)
- [x] `packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts` — 6 testes: FUP-07 (timezone/horário comercial)
- [x] `packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` — 3 testes: FUP-06 (resetFup)
- [x] `packages/database/src/schema/tables.test.ts` — 13 testes FUP adicionados: campos leads FUP + tabela fup_config

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated | 0 |

**Gap resolvido:** 22-01-01 — adicionado describe `FUP Schema (FUP-01, FUP-08)` em `packages/database/src/schema/tables.test.ts` com 13 testes cobrindo campos FUP em `leads` e tabela `fup_config`.

**Suite final:** 84 testes passando (65 packages/database + 19 packages/core/fup), 0 falhas.
