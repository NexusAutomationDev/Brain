---
phase: 8
slug: brainrunner-conversation-history
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (built-in, Bun 1.x) |
| **Config file** | Nenhum — bun test sem config file necessário |
| **Quick run command** | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` |
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
| 08-01-01 | 01 | 1 | HIST-01 | — | `thread_id` derivado de `lead.uniqueId` (DB lookup), nunca de `event.Numero` | integration | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | ✅ arquivo existe, assert novo necessário | ⬜ pending |
| 08-01-02 | 01 | 1 | HIST-02 | — | Histórico completo carregado via PostgresSaver na segunda chamada com mesmo IDLead | integration | `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts` | ✅ arquivo existe, assert precisa de verificação explícita | ⬜ pending |
| 08-02-01 | 02 | 2 | HIST-03 | T-08-ENV | `CONTEXT_WINDOW_MESSAGES` lido com fallback `?? "40"` — NaN impossível | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ❌ W0 — casos novos necessários | ⬜ pending |
| 08-02-02 | 02 | 2 | HIST-03 | — | Nó do grafo usa `state.messages.slice(-N)` antes de chamar LLM | unit + integration | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ❌ W0 — mock de getState necessário | ⬜ pending |
| 08-03-01 | 03 | 3 | HIST-01–03 | — | `.env.example` contém `CONTEXT_WINDOW_MESSAGES=40` | file check | `grep "CONTEXT_WINDOW_MESSAGES" apps/brain-echo/.env.example` | ❌ W0 — linha nova necessária | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/runner/__tests__/brain-runner.test.ts` — adicionar casos de teste para `getState()` mock e context window (HIST-03)
- [ ] `packages/core/src/runner/__tests__/brain-runner.integration.test.ts` — atualizar asserts HIST-01 (mesmo IDLead + Numeros diferentes = mesmo thread) e HIST-02 (histórico acumulado entre chamadas)

*Arquivos de infraestrutura de teste já existem — apenas novos casos/assertions necessários.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Conversa longa (30-80 turnos) não causa overflow de contexto do LLM | HIST-03 | Requer 30-80 chamadas reais ao LLM via integration test — lento e custoso para CI | Rodar manualmente: enviar 50 eventos com mesmo IDLead via BrainRunner e verificar que o modelo não recebe mais de `CONTEXT_WINDOW_MESSAGES` mensagens no turn 51 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
