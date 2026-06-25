---
phase: 24
slug: tech-debt-cleanup
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in) |
| **Config file** | none — bun built-in |
| **Quick run command** | `cd /root/Brain && bun test packages/core/src/runner/__tests__/runner-wr.test.ts packages/core/src/__tests__/unit/fup/` |
| **Full suite command** | `cd /root/Brain && bun test packages/core/src` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 7 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | WR-01 | T-24-01 | Log emite apenas `brainType` e `hasFupUrl: true`, nunca a URL em si | unit | `bun test packages/core/src/runner/__tests__/runner-wr.test.ts` | ✅ | ✅ green |
| 24-01-02 | 01 | 1 | WR-03 | T-24-02 | SIGTERM listener removido em close() — sem MaxListenersExceededWarning | unit | `bun test packages/core/src/runner/__tests__/runner-wr.test.ts` | ✅ | ✅ green |
| 24-01-03 | 01 | 1 | WR-02 | T-24-03 | `updatedAt: new Date()` usa timestamp do servidor, sem input externo | unit | `bun test packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts` | ✅ | ✅ green |
| 24-02-01 | 02 | 1 | WR-04 | T-24-04 | Delay de 1s entre retries — reduz thundering herd de 30 calls simultâneos | unit | `bun test packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` | ✅ | ✅ green |
| 24-03-01 | 03 | 2 | SC-5 | T-24-07 | TypeScript compila com 0 erros — nenhum tipo inseguro exposto | compile | `cd /root/Brain && bun tsc --noEmit -p packages/core/tsconfig.json && echo "OK"` | ✅ | ✅ green |
| 24-03-02 | 03 | 2 | RAG-02/RAG-03 | — | N/A — mudança de metadados de rastreabilidade | manual | — | — | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files required (runner-wr.test.ts created by Nyquist audit, not Wave 0).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| RAG-02/RAG-03 checkboxes atualizados em REQUIREMENTS.md | RAG-02, RAG-03 | Mudança de metadados de planejamento — sem comportamento de código | `grep "RAG-02\|RAG-03" .planning/REQUIREMENTS.md` — confirmar `[x]` e `Complete` |
| EVT-03 traceability aponta para Phase 22 | EVT-03 | Correção de referência cruzada em documento de planejamento | `grep "EVT-03" .planning/REQUIREMENTS.md` — confirmar `Phase 22` |

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

**Gaps resolvidos:**
- WR-01: `runner-wr.test.ts` — 3 testes (warn disparado, não disparado com checkpointer, não disparado sem URL)
- WR-03: `runner-wr.test.ts` — 4 testes (listener adicionado, removido, ciclo init/close, idempotência de close)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24
