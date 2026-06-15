---
phase: 10
slug: output-parser-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in, Jest-compatible) |
| **Config file** | none — built into Bun runtime |
| **Quick run command** | `bun test packages/core/src/__tests__` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/__tests__`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | PARSER-01 | — | Schema rejeita output inválido | unit | `bun test packages/core/src/__tests__/unit/output` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | PARSER-01 | — | BrainOutput type em shared compila | unit | `bun build packages/shared` | ✅ | ⬜ pending |
| 10-02-01 | 02 | 2 | PARSER-02 | — | BrainRunner lança erro p/ output inválido | unit | `bun test packages/core/src/__tests__/unit/runner` | ✅ | ⬜ pending |
| 10-02-02 | 02 | 2 | PARSER-01 | — | IBrain.run() retorna BrainOutput | build | `bun build packages/core` | ✅ | ⬜ pending |
| 10-03-01 | 03 | 3 | PARSER-02 | — | brain-echo compila com novo contrato | build | `bun build apps/brain-echo` | ✅ | ⬜ pending |
| 10-03-02 | 03 | 3 | PARSER-02 | — | Testes brain-echo passam | unit | `bun test apps/brain-echo` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/__tests__/unit/output/schema.test.ts` — stubs para PARSER-01 (BrainOutputSchema validação)
- [ ] `packages/core/src/__tests__/unit/output/` — diretório para testes do schema

*Existing infrastructure covers runner tests and brain-echo tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BrainRunner.run() retorna `null` quando `ia_ativada=false` | PARSER-02 | Requer lead com flag false no banco | Criar lead com `ia_ativada=false`, chamar runner, verificar retorno null |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
