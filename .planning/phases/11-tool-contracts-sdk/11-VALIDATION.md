---
phase: 11
slug: tool-contracts-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in Bun 1.x) |
| **Config file** | Nenhum — `bun test` usa padrão de descoberta |
| **Quick run command** | `bun test packages/core/src/tools/__tests__/` |
| **Full suite command** | `bun test packages/core/` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/tools/__tests__/`
- **After every plan wave:** Run `bun test packages/core/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-??-01 | BrainBuildContext | 1 | TOOLS-STD-01, TOOLS-STD-02 | — | N/A | unit | `bun test packages/core/src/tools/__tests__/` | ✅ W0 | ⬜ pending |
| 11-??-02 | ToolsRegistry BRAIN_TOOLS | 1 | TOOLS-ENV-01, TOOLS-ENV-02 | — | BRAIN_TOOLS whitelist prevents unauthorized tool registration | unit | `bun test packages/core/src/tools/__tests__/tools-registry.test.ts` | ✅ parcial | ⬜ pending |
| 11-??-03 | LeadService methods | 1 | TOOLS-STD-01, TOOLS-STD-02 | — | N/A | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ parcial | ⬜ pending |
| 11-??-04 | pause_session tool | 1 | TOOLS-STD-01 | — | thread_id lido do config — LLM não pode fornecer lead_id | unit | `bun test packages/core/src/tools/__tests__/pause-session.test.ts` | ❌ W0 | ⬜ pending |
| 11-??-05 | finish_conversation tool | 1 | TOOLS-STD-02 | — | thread_id lido do config — update atômico (ia_ativada + fullpp) | unit | `bun test packages/core/src/tools/__tests__/finish-conversation.test.ts` | ❌ W0 | ⬜ pending |
| 11-??-06 | Barrel exports | 1 | TOOLS-STD-01, TOOLS-STD-02 | — | N/A | unit | `bun test packages/core/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/tools/__tests__/pause-session.test.ts` — stubs para TOOLS-STD-01
- [ ] `packages/core/src/tools/__tests__/finish-conversation.test.ts` — stubs para TOOLS-STD-02
- [ ] Casos adicionais em `packages/core/src/tools/__tests__/tools-registry.test.ts` — cobre TOOLS-ENV-01 e TOOLS-ENV-02
- [ ] Casos adicionais em `packages/core/src/leads/__tests__/lead-service.test.ts` — cobre `setFullpp()` e `setIaAtivada()`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `BRAIN_TOOLS` ENV em brain-sdr real | TOOLS-ENV-01 | Requer instância rodando com ENV configurado | Subir brain-sdr com `BRAIN_TOOLS=pause_session,finish_conversation`; tentar habilitar tool não listada via código; confirmar que apenas as listadas aparecem em `getTools()` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
