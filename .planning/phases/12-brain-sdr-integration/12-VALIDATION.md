---
phase: 12
slug: brain-sdr-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.x) |
| **Config file** | Nenhum — `bun test` não requer config |
| **Quick run command** | `bun test apps/brain-sdr/src/__tests__/unit` |
| **Full suite command** | `bun test` (todos os workspaces) |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test apps/brain-sdr/src/__tests__/unit`
- **After every plan wave:** Run `bun test` (workspace completo)
- **Before `/gsd-verify-work`:** `turbo run build && turbo run lint && bun test` — todos verdes
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | PARSER-03 | — | N/A | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ⬜ pending |
| 12-01-02 | 01 | 1 | TOOLS-STD-03 | — | thread_id de RunnableConfig, nunca do LLM | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ⬜ pending |
| 12-01-03 | 01 | 1 | PARSER-03 | — | N/A | unit | `bun test packages/transport/src/__tests__/unit` | ✅ | ⬜ pending |
| 12-01-04 | 01 | 1 | TOOLS-STD-03 | — | N/A | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — já existe; adicionar casos para 3 tools + brainOutput
- `packages/transport/src/webhook/handler.test.ts` — já existe; atualizar 1 caso `body.reply` → `body.fullResponse`

*Nenhum arquivo novo de teste precisa ser criado. Infraestrutura de teste já existe.*

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
