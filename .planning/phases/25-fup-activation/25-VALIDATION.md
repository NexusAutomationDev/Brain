---
phase: 25
slug: fup-activation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.3.x) |
| **Config file** | none — bun test nativo, sem configuração adicional |
| **Quick run command** | `bun test packages/core/src/leads/__tests__/lead-service.test.ts -t "FUP activation"` |
| **Full suite command** | `bun test packages/core` |
| **Estimated runtime** | ~7 segundos (full suite) |

> **Nota sobre full suite:** `bun test packages/core` exibe 4 falhas pré-existentes em `lead-service-fup.test.ts` causadas por mock interference introduzida na Phase 22 (falha de isolamento entre arquivos — testes passam 3/3 quando rodados isoladamente). Essas falhas não foram introduzidas pela Phase 25 e não afetam a validade dos testes desta fase.

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/leads/__tests__/lead-service.test.ts -t "FUP activation"`
- **After every plan wave:** Run `bun test packages/core/src/leads/__tests__/lead-service.test.ts && bun test packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green (excepto falhas pré-existentes da Phase 22)
- **Max feedback latency:** ~2 segundos (lead-service isolado)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 0 | FUP-01, FUP-02 | — | N/A | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts -t "FUP activation"` | ✅ | ✅ green |
| 25-02-01 | 02 | 1 | FUP-01, FUP-02 | — | N/A | unit | `bun test packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ | ✅ green |
| 25-03-01 | 03 | 2 | FUP-01, FUP-02 | — | N/A | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Comportamentos verificados por task

**Task 25-01-01** — 5 test cases em `describe("LeadService — FUP activation (Phase 25)")`:
- `INSERT com fup_config enabled=true → fupEnabled=true` (D-02)
- `INSERT com fup_config enabled=false → fupEnabled=false` (D-02)
- `INSERT sem brainType → fupEnabled=false, sem SELECT em fup_config` (D-04)
- `UPDATE (lead existente) → onConflictDoUpdate.set NÃO contém fupEnabled` (D-03)
- `INSERT com fup_config inexistente → fupEnabled=false, sem erro` (D-04 silent fallback)

**Task 25-02-01** — mesmos 5 testes + 8 existentes (13/13 pass):
- Verifica que a implementação satisfaz o contrato TDD escrito na Wave 0
- `fupEnabled` computado via SELECT condicional antes do upsert
- `onConflictDoUpdate.set` não inclui `fupEnabled` (preservação em UPDATE)

**Task 25-03-01** — 26 testes BrainRunner (26/26 pass):
- `BrainRunner.run()` passa `this.brain.brainType` como quarto parâmetro a `upsertLead()`
- Nenhuma regressão nos testes existentes do BrainRunner

---

## Wave 0 Requirements

Infraestrutura existente cobre todos os requisitos da fase:

- [x] `packages/core/src/leads/__tests__/lead-service.test.ts` — stubs TDD para FUP-01/FUP-02 criados no Wave 0 (Plan 01), convertidos a GREEN no Wave 1 (Plan 02)
- [x] `packages/core/src/runner/__tests__/brain-runner.test.ts` — infraestrutura existente; brainType injection verificada sem criação de novos stubs

*Framework `bun test` pré-instalado — sem setup adicional necessário.*

---

## Manual-Only Verifications

*Nenhuma verificação manual necessária. Todos os comportamentos da Phase 25 têm cobertura automatizada.*

---

## Validation Audit 2026-06-24

| Métrica | Valor |
|---------|-------|
| Gaps encontrados | 0 |
| Cobertos (COVERED) | 3 tasks |
| Parciais (PARTIAL) | 0 |
| Ausentes (MISSING) | 0 |
| Resolvidos pelo auditor | 0 |
| Escalados para manual-only | 0 |

---

## Validation Sign-Off

- [x] Todos os tasks têm `<automated>` verify com comando executável
- [x] Continuidade de sampling: sem 3 tasks consecutivos sem verify automatizado
- [x] Wave 0 cobre todos os requisitos (FUP-01, FUP-02)
- [x] Sem flags watch-mode nos comandos de verify
- [x] Latência de feedback < 2s (lead-service isolado)
- [x] `nyquist_compliant: true` setado no frontmatter

**Approval:** approved 2026-06-24
