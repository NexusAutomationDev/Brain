---
phase: 8
slug: brainrunner-conversation-history
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-14
audited: 2026-06-14
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in, Bun 1.x) |
| **Config file** | Nenhum — bun test sem config file necessário |
| **Quick run command** | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts apps/brain-echo/src/__tests__/unit/brain.test.ts` |
| **Full suite command** | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` |
| **Estimated runtime** | ~5s (unit) / ~15s (integration com DB) |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/runner/__tests__/brain-runner.test.ts`
- **After every plan wave:** Run `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | HIST-01 | — | `thread_id` derivado de `lead.uniqueId` (IDLead canônico), nunca de `event.Numero` — dois Numeros distintos com mesmo IDLead compartilham checkpoint | integration | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | ✅ `brain-runner.integration.test.ts` · teste `HIST-01` com `msgCount2 > 1` | ✅ green |
| 08-01-02 | 01 | 1 | HIST-02 | — | Histórico acumula via PostgresSaver entre chamadas consecutivas com mesmo IDLead | integration | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | ✅ `brain-runner.integration.test.ts` · teste `HIST-02` com `msgCount2 > msgCount1` | ✅ green |
| 08-02-01 | 02 | 2 | HIST-03 | T-08-ENV | `CONTEXT_WINDOW_MESSAGES` lido com `parseInt + isFinite + > 0`, fallback 40 — NaN/negativo impossível | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ `brain-runner.test.ts` · 4 testes `HIST-03` (fallback 40, ENV=10, ENV='abc', getState com thread_id correto) | ✅ green |
| 08-02-02 | 02 | 2 | HIST-03 | — | Nó do grafo usa `state.messages.slice(-N)` antes de chamar LLM; slice preserva últimas N mensagens | unit | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` | ✅ `brain.test.ts` · 4 testes HIST-03 (slice-limit, passthrough, fallback T-08-ENV, node-direct) | ✅ green |
| 08-03-01 | 02 | 2 | HIST-01–03 | — | `.env.example` contém `CONTEXT_WINDOW_MESSAGES=40` | file check | `grep "CONTEXT_WINDOW_MESSAGES" apps/brain-echo/.env.example` | ✅ linha `CONTEXT_WINDOW_MESSAGES=40` presente em `.env.example` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/core/src/runner/__tests__/brain-runner.test.ts` — 4 testes HIST-03 adicionados (Plan 02, Task 1)
- [x] `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` — testes HIST-01 e HIST-02 adicionados com `historyAwareBrain` + reply-encoding pattern (Plan 01)
- [x] `apps/brain-echo/src/__tests__/unit/brain.test.ts` — 4 testes HIST-03 para slice + fallback (Plan 02, Task 2)
- [x] `apps/brain-echo/.env.example` — `CONTEXT_WINDOW_MESSAGES=40` adicionado (Plan 02, Task 2)

*Todos os Wave 0 items resolvidos durante a execução dos Plans 01 e 02.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Conversa longa (30-80 turnos) não causa overflow de contexto do LLM | HIST-03 | Requer 30-80 chamadas reais ao LLM via integration test — lento e custoso para CI | Rodar manualmente: enviar 50 eventos com mesmo IDLead via BrainRunner e verificar que o modelo não recebe mais de `CONTEXT_WINDOW_MESSAGES` mensagens no turn 51 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-14

---

## Validation Audit 2026-06-14

| Metric | Count |
|--------|-------|
| Gaps found | 5 |
| Resolved | 5 |
| Escalated | 0 |

**Summary:** Todos os 5 gaps pendentes no draft inicial foram resolvidos pelos Plans 01 e 02 antes desta auditoria. 23 testes unitários verdes (`brain-runner.test.ts` × 13 + `brain.test.ts` × 10). Testes de integração (HIST-01, HIST-02) existem e passam quando `TEST_DB_URL` está disponível. `.env.example` contém `CONTEXT_WINDOW_MESSAGES=40` conforme especificado.
