---
phase: 13
slug: suporte-a-pgbouncer-para-connection-pooling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in, v1.3.2) |
| **Config file** | none — bun test sem config |
| **Quick run command** | `bun test packages/database/src/` |
| **Full suite command** | `bun test packages/database/src/ packages/ai/src/ apps/brain-sdr/src/` |
| **Estimated runtime** | ~500ms (baseline: migrate.test.ts 238ms) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/database/src/migrate.test.ts`
- **After every plan wave:** Run `bun test packages/database/src/ packages/ai/src/ apps/brain-sdr/src/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~500ms

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | PGB-01 | — | N/A | unit | `bun test packages/database/src/pool-manager.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | PGB-02 | — | N/A | unit | `bun test packages/database/src/migrate.test.ts` | ✅ (adaptar) | ⬜ pending |
| 13-01-03 | 01 | 1 | PGB-03 | — | N/A | unit | `bun test packages/database/src/migrate.test.ts` | ✅ (adaptar) | ⬜ pending |
| 13-01-04 | 01 | 1 | PGB-04 | T-09-03-05 | saver.end() fechado em finally; DATABASE_URL nunca logada | unit | `bun test apps/brain-sdr/src/__tests__/unit/` | ❌ W0 | ⬜ pending |
| 13-01-05 | 01 | 1 | PGB-05 | — | N/A | unit | `bun test packages/database/src/migrate.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/database/src/pool-manager.test.ts` — implementar testes para `prepare: false` (PGB-01); substituir `it.todo` pelos testes reais
- [ ] `packages/database/src/migrate.test.ts` — adaptar mocks de `pg_advisory_lock` para row-lock; adicionar teste para `prepare: false` no bloco CLI (PGB-02, PGB-03, PGB-05)
- [ ] `apps/brain-sdr/src/__tests__/unit/qualifier.test.ts` — verificar se existe; adicionar/adaptar teste para `saver.end()` em finally (PGB-04)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PostgresSaver requer PgBouncer session mode (ou ≥ 1.21) | D-05 | Requer PgBouncer real em transaction mode para verificar incompatibilidade | Documentar na review — não testar automaticamente; limitação do driver `pg` v8.21 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 500ms
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
