---
phase: 9
slug: brain-sdr
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.x) |
| **Config file** | none — Bun descobre `__tests__/` automaticamente |
| **Quick run command** | `bun test src/__tests__/unit` |
| **Full suite command** | `bun test src/__tests__` |
| **Estimated runtime** | ~5 seconds (unit); ~15 seconds (integration + DB) |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/__tests__/unit`
- **After every plan wave:** Run `bun test src/__tests__`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | SDR-04 | — | Prompt seed idempotente via ON CONFLICT | manual | DB migration runs on init | ❌ W0 | ⬜ pending |
| 9-02-01 | 02 | 2 | SDR-01, SDR-04, SDR-05 | — | bindTools() presente; sem .compile() em buildGraph | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-02 | 02 | 2 | SDR-05 | — | PostgresSaver.getTuple() sem setup(); fallback em erro | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-03 | 02 | 2 | SDR-05 | — | qualify_lead retorna {qualificado, motivo, proximo_passo} | integration | `bun test src/__tests__/integration` | ❌ W0 | ⬜ pending |
| 9-03-01 | 03 | 3 | INFRA-01 | — | TenantPoolManager.getPool(DATABASE_NAME) → Sql para BrainRunner | unit | `bun test src/__tests__/unit/brain.test.ts` | ❌ W0 | ⬜ pending |
| 9-03-02 | 03 | 3 | SDR-01, SDR-02, SDR-03 | — | Brain SDR herda ia_ativada gate e histórico de BrainRunner | integration | `bun test src/__tests__/integration` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — stubs para SDR-01, SDR-04, SDR-05, INFRA-01
- [ ] `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` — stubs para SDR-05 (requer PostgreSQL real)
- [ ] `apps/brain-sdr/package.json` — scripts `test` e `test:integration`

*Wave 0 deve ser o primeiro plano a executar — cria arquivos de teste antes que os demais planos criem o código.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM decide chamar qualify_lead em contexto real de SDR | SDR-05 | Requer julgamento subjetivo de timing do tool call | Conversar com Brain SDR até o lead demonstrar interesse; verificar log de tool_call |
| TenantPoolManager isola banco correto em produção | INFRA-01 | Requer 2 instâncias Docker com DATABASE_NAME distintos | Subir 2 containers com DBs diferentes; confirmar que cada um escreve no banco correto |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
