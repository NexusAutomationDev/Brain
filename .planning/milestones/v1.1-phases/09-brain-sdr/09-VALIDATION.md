---
phase: 9
slug: brain-sdr
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-14
audited: 2026-06-14
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
| **Estimated runtime** | ~1 segundo (unit); ~15 segundos (integration + DB) |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/__tests__/unit`
- **After every plan wave:** Run `bun test src/__tests__`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | SDR-04 | manual | DB migration runs on init | — | 🔵 manual |
| 9-02-01 | 02 | 2 | SDR-01, SDR-04, SDR-05 | unit | `bun test src/__tests__/unit/brain.test.ts` | ✅ | ✅ green |
| 9-02-02 | 02 | 2 | SDR-05 | unit | `bun test src/__tests__/unit/qualifier.unit.test.ts` | ✅ | ✅ green |
| 9-02-03 | 02 | 2 | SDR-05 | manual | requer PostgreSQL real + checkpoint populado | ✅ (skip) | 🔵 manual |
| 9-03-01 | 03 | 3 | INFRA-01 | unit | `bun test packages/database/src/pool-manager.test.ts` | ✅ (cross-pkg) | ✅ green |
| 9-03-02 | 03 | 3 | SDR-01, SDR-02, SDR-03 | manual | requer stack completo (DB + LLM + BrainRunner) | ✅ (skip) | 🔵 manual |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · 🔵 manual*

---

## Wave 0 Requirements

- [x] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — SDR-01, SDR-04, SDR-05 IBrain contract (9 tests GREEN)
- [x] `apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts` — SDR-05 fallback + anti-pattern estático (6 tests GREEN)
- [x] `apps/brain-sdr/src/__tests__/integration/qualify.test.ts` — SDR-05 + SDR-01..03 (estrutura documentada, skip sem DB)
- [x] `apps/brain-sdr/package.json` — scripts `test` e `test:integration`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Prompt seed idempotente via ON CONFLICT ao reiniciar | SDR-04 | Requer banco real; testar via `docker restart` | Reiniciar container; verificar que `SELECT COUNT(*) FROM prompts` permanece o mesmo |
| LLM decide chamar qualify_lead em contexto real | SDR-05 | Julgamento subjetivo de timing do tool call | Conversar com Brain SDR até lead demonstrar interesse; verificar log de tool_call |
| qualify_lead retorna `{qualificado, motivo, proximo_passo}` com DB real | SDR-05 | Requer PostgreSQL com checkpoint populado | Executar `bun test:integration` com `DATABASE_URL` apontando para banco com dados reais |
| BrainRunner + BrainSDR — ia_ativada gate + histórico de conversa | SDR-01..03 | Requer stack completo (DB + LLM API key + BrainRunner) | Subir container com todas as ENVs; enviar mensagem via webhook; verificar reply + persistência |
| TenantPoolManager isola banco correto em produção | INFRA-01 | Requer 2 instâncias Docker com DATABASE_NAME distintos | Subir 2 containers; confirmar isolamento de escrita por DATABASE_NAME |

---

## Validation Sign-Off

- [x] All tasks have automated verify or documented manual-only rationale
- [x] Sampling continuity: unit suite cobre todas as tasks com código puro testável
- [x] Wave 0 complete — todos os arquivos de teste existem
- [x] No watch-mode flags
- [x] Feedback latency < 15s (unit suite: ~1s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ 2026-06-14

---

## Validation Audit 2026-06-14

| Metric | Count |
|--------|-------|
| Tasks auditados | 6 |
| Gaps encontrados | 3 (9-02-02 PARTIAL, 9-02-03 PARTIAL, 9-03-02 PARTIAL) |
| Resolvidos automaticamente | 1 (9-02-02 → `qualifier.unit.test.ts`, 6 testes) |
| Promovidos a manual-only | 2 (9-02-03, 9-03-02 — requerem infraestrutura real) |
| Testes unit GREEN pós-auditoria | 15 (9 brain.test.ts + 6 qualifier.unit.test.ts) |
