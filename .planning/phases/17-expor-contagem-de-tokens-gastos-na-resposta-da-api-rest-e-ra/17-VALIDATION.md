---
phase: 17
slug: expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test |
| **Config file** | `package.json` (workspaces) |
| **Quick run command** | `bun test packages/shared packages/ai packages/core packages/transport` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/shared packages/ai packages/core packages/transport`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | D-03 | — | N/A | unit | `bun test packages/shared` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | D-07 | — | N/A | unit | `bun test packages/ai` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | D-07 | — | N/A | unit | `bun test packages/ai` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 2 | D-02,D-08 | — | N/A | unit | `bun test packages/core` | ✅ | ⬜ pending |
| 17-02-02 | 02 | 2 | D-09 | — | N/A | unit | `bun test packages/transport` | ✅ | ⬜ pending |
| 17-02-03 | 02 | 2 | D-10 | — | N/A | unit | `bun test packages/transport` | ✅ | ⬜ pending |
| 17-03-01 | 03 | 3 | D-06,D-07 | — | N/A | integration | `bun test apps/brain-sdr` | ✅ | ⬜ pending |
| 17-03-02 | 03 | 3 | D-06,D-07 | — | N/A | integration | `bun test apps/brain-echo` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/__tests__/unit/token-usage.test.ts` — stubs para tipo `TokenUsage` (D-03)
- [ ] `packages/ai/src/__tests__/unit/token.test.ts` — stubs para `extractTokenUsage()` helper (D-07)
- [ ] `packages/ai/src/__tests__/unit/state.test.ts` — stubs para reducer de soma em `BrainStateAnnotation` (D-07)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resposta HTTP inclui `tokenUsage` com valores reais | D-09 | Requer LLM call real com provider | Enviar mensagem via webhook, verificar JSON de resposta contém `tokenUsage.totalTokens > 0` |
| Log Pino em consumer RabbitMQ contém `tokenUsage` | D-10 | Requer broker RabbitMQ ativo | Publicar mensagem na fila, verificar log estruturado contém campo `tokenUsage` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
