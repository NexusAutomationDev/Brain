---
phase: 19
slug: database-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
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
| 19-01-01 | 01 | 1 | FUP-04 | — | Migration idempotente | integration | `bun test packages/database --grep migration` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | FUP-04 | — | Tabela fup_config criada | integration | `bun test packages/database --grep fup_config` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | FUP-04 | — | Tabela knowledge_chunks criada | integration | `bun test packages/database --grep knowledge_chunks` | ❌ W0 | ⬜ pending |
| 19-01-04 | 01 | 1 | FUP-06 | — | Colunas FUP em leads criadas | integration | `bun test packages/database --grep leads_fup` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 1 | FUP-06 | — | touchLastMessage() atualiza last_message_at | unit | `bun test packages/core --grep touchLastMessage` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 1 | FUP-06 | — | BrainRunner chama touchLastMessage() antes do gate | integration | `bun test packages/core --grep runner_fup` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/database/src/__tests__/integration/migration-v14.test.ts` — testes de aplicação da migration 0007
- [ ] `packages/core/src/__tests__/unit/lead-service-touch.test.ts` — testes para touchLastMessage()
- [ ] `packages/core/src/__tests__/integration/runner-fup.test.ts` — testes de integração BrainRunner + touchLastMessage()

*Infraestrutura bun test já existe — apenas novos arquivos de teste necessários.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration em banco com dados existentes | FUP-04 SC-1 | Requer banco real com dados | `psql $DATABASE_URL -c "\d knowledge_chunks"` após migration |
| Migration em banco limpo | FUP-04 SC-1 | Requer banco real | `psql $DATABASE_URL -c "\d fup_config"` após migration |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
