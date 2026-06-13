---
phase: 4
slug: validation-brain
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.3.2) |
| **Config file** | none — zero-config |
| **Quick run command** | `bun test apps/brain-echo/src/__tests__/unit` |
| **Full suite command** | `bun test apps/brain-echo/src/__tests__` |
| **Estimated runtime** | ~75 seconds (unit ~5s + integration ~70s due to SC-3/SC-4 timeouts) |

---

## Sampling Rate

- **After every task commit:** Run `bun test apps/brain-echo/src/__tests__/unit`
- **After every plan wave:** Run `bun test apps/brain-echo/src/__tests__/unit && bun test apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~75 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 0 | INFRA-03 | — | N/A | unit | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 1 | INFRA-03 SC-2 | T-4-01 | Zod valida body; DedupCache rejeita replay | integration | `bun test apps/brain-echo/src/__tests__/integration/webhook.test.ts` | ❌ W0 | ⬜ pending |
| 4-03-01 | 03 | 2 | INFRA-03 SC-3 | — | PostgresSaver preserva thread state entre restarts | integration | `bun test apps/brain-echo/src/__tests__/integration/restart.test.ts` | ❌ W0 | ⬜ pending |
| 4-04-01 | 04 | 2 | INFRA-03 SC-4 | — | TenantPoolManager mantém conexões abaixo do LRU cap | integration | `bun test apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts` | ❌ W0 | ⬜ pending |
| 4-05-01 | 05 | 2 | INFRA-03 SC-1 | — | N/A (Docker smoke) | manual | ver Manual-Only Verifications | ❌ manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/brain-echo/src/__tests__/unit/brain.test.ts` — stubs de contrato IBrain (EchoBrain.id, brainType, promptKeys, tools, buildGraph retorna StateGraph)
- [ ] `apps/brain-echo/src/__tests__/integration/webhook.test.ts` — stubs para SC-2 (cobre INFRA-03 SC-2)
- [ ] `apps/brain-echo/src/__tests__/integration/restart.test.ts` — stubs para SC-3 (cobre INFRA-03 SC-3)
- [ ] `apps/brain-echo/src/__tests__/integration/tenant-pool.test.ts` — stubs para SC-4 (cobre INFRA-03 SC-4)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker build` produz imagem válida e container sobe sem erros | INFRA-03 SC-1 | Requer Docker build em CI com contexto do monorepo; não é automático via `bun test` | `docker build -f apps/brain-echo/Dockerfile . -t brain-echo-test && docker run --rm --env-file .env brain-echo-test bun --version` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 75s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
