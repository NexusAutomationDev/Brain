---
phase: 19
slug: database-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
audited: 2026-06-24
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | none — bun test nativo |
| **Quick run command** | `bun test packages/database packages/core` |
| **Full suite command** | `bun test packages/database packages/core` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/database packages/core`
- **After every plan wave:** Run `bun test packages/database packages/core`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | FUP-04 | — | Migration idempotente | integration | `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` | ✅ | ✅ green |
| 19-01-02 | 01 | 1 | FUP-04 | — | Tabela fup_config criada | integration | `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` | ✅ | ✅ green |
| 19-01-03 | 01 | 1 | FUP-04 | — | Tabela knowledge_chunks criada | integration | `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` | ✅ | ✅ green |
| 19-01-04 | 01 | 1 | FUP-06 | — | Colunas FUP em leads criadas | integration | `bun test packages/database/src/__tests__/integration/migration-v14.test.ts` | ✅ | ✅ green |
| 19-02-01 | 02 | 1 | FUP-06 | — | touchLastMessage() atualiza last_message_at | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ | ✅ green |
| 19-02-02 | 02 | 1 | FUP-06 | — | BrainRunner chama touchLastMessage() antes do gate | integration | `bun test packages/core/src/runner/__tests__/runner-fup.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/database/src/__tests__/integration/migration-v14.test.ts` — 13 testes scaffold, todos GREEN
- [x] `packages/core/src/leads/__tests__/lead-service.test.ts` — 8 testes (inclui 3 para touchLastMessage()), todos GREEN
- [x] `packages/core/src/runner/__tests__/runner-fup.test.ts` — 3 testes BrainRunner + touchLastMessage(), todos GREEN

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration em banco com dados existentes | FUP-04 SC-1 | Requer banco real com dados | `psql $DATABASE_URL -c "\d knowledge_chunks"` após migration |
| Migration em banco limpo | FUP-04 SC-1 | Requer banco real | `psql $DATABASE_URL -c "\d fup_config"` após migration |

> **Nota:** Migration 0007 verificada manualmente via psql em 2026-06-23 contra `brain_test` (PostgreSQL 14 via Docker). Todos os 6 objetos verificados: `knowledge_chunks` ✅, `fup_config` ✅, `leads.fup_enabled` ✅, `leads.fup_step` ✅, `leads.fup_next_at` ✅, `leads.last_message_at` ✅.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all requirements
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

**Gap resolvido:** 19-02-02 — Mock de `LeadService` em `runner-fup.test.ts` não incluía `resetFup` (adicionado ao `runner.ts` na Phase 22). Fix: adicionado `mockResetFup` ao mock. Todos os 3 testes passam GREEN.
