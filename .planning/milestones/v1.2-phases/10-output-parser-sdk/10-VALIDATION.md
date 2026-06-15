---
phase: 10
slug: output-parser-sdk
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-14
audited: 2026-06-15
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
| 10-01-01 | 01 | 1 | PARSER-01 | — | Schema rejeita output inválido | unit | `bun test packages/core/src/__tests__/unit/output` | ✅ | ✅ green |
| 10-01-02 | 01 | 1 | PARSER-01 | — | BrainOutput type em shared compila | typecheck | `bun run --cwd packages/shared typecheck` | ✅ | ✅ green |
| 10-02-01 | 02 | 2 | PARSER-02 | — | BrainRunner lança erro p/ output inválido | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |
| 10-02-02 | 02 | 2 | PARSER-01 | — | IBrain.run() retorna BrainOutput | typecheck | `bun run --cwd packages/core typecheck` | ✅ | ✅ green |
| 10-03-01 | 03 | 3 | PARSER-02 | — | brain-echo compila com novo contrato | typecheck | `bun run --cwd apps/brain-echo typecheck` | ✅ | ✅ green |
| 10-03-02 | 03 | 3 | PARSER-02 | — | Testes brain-echo passam | unit | `bun test apps/brain-echo/src/__tests__/unit` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/__tests__/unit/output/schema.test.ts` — stubs para PARSER-01 (BrainOutputSchema validação)
- [x] `packages/core/src/__tests__/unit/output/` — diretório para testes do schema

*Existing infrastructure covers runner tests and brain-echo tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BrainRunner.run() retorna `null` quando `ia_ativada=false` | PARSER-02 | Requer lead com flag false no banco | Criar lead com `ia_ativada=false`, chamar runner, verificar retorno null |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ compliant

---

## Validation Audit 2026-06-15

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Evidence:**

| Command | Result |
|---------|--------|
| `bun test packages/core/src/__tests__/unit/output` | 9 pass, 0 fail |
| `bun run --cwd packages/shared typecheck` | clean (tsc --noEmit) |
| `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 18 pass, 0 fail |
| `bun run --cwd packages/core typecheck` | clean (tsc --noEmit) |
| `bun run --cwd apps/brain-echo typecheck` | clean (tsc --noEmit) |
| `bun test apps/brain-echo/src/__tests__/unit` | 10 pass, 0 fail |

**Notes:** Comandos de build (`bun build packages/core`, `bun build apps/brain-echo`) substituídos por typecheck — `bun build` sem entry point falha neste monorepo. Typecheck com `tsc --noEmit` é verificação equivalente de contrato de tipos. Path do runner corrigido: `packages/core/src/runner/__tests__/brain-runner.test.ts` (não `packages/core/src/__tests__/unit/runner`).

PARSER-01 → **COVERED** · PARSER-02 → **COVERED** · `nyquist_compliant: true`
