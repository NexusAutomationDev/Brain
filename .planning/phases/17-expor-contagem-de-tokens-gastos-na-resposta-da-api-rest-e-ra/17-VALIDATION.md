---
phase: 17
slug: expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
audited: 2026-06-16
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test |
| **Config file** | `package.json` (workspaces) |
| **Quick run command** | `bun test packages/ai/src/graph/state.test.ts apps/brain-sdr/src/__tests__/unit/brain.test.ts apps/brain-echo/src/__tests__/unit/brain.test.ts` |
| **Full suite command** | `bun test packages/shared packages/ai packages/core packages/transport apps/brain-sdr apps/brain-echo` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/shared packages/ai packages/core packages/transport`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|------|--------|
| 17-01-01 | 01 | 1 | D-03 | — | N/A | unit | `bun test packages/ai/src/__tests__/unit/token.test.ts` | `packages/ai/src/__tests__/unit/token.test.ts` | ✅ green |
| 17-01-02 | 01 | 1 | D-07 | — | N/A | unit | `bun test packages/ai/src/__tests__/unit/token.test.ts` | `packages/ai/src/__tests__/unit/token.test.ts` | ✅ green |
| 17-01-03 | 01 | 1 | D-07 | — | N/A | unit | `bun test packages/ai/src/graph/state.test.ts` | `packages/ai/src/graph/state.test.ts` | ✅ green |
| 17-02-01 | 02 | 2 | D-02,D-08 | — | N/A | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | `packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ green |
| 17-02-02 | 02 | 2 | D-09 | — | N/A | unit | `bun test packages/transport/src/webhook/handler.test.ts` | `packages/transport/src/webhook/handler.test.ts` | ✅ green |
| 17-02-03 | 02 | 2 | D-10 | — | N/A | unit | `bun test packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 17-03-01 | 03 | 3 | D-06,D-07 | — | N/A | unit | `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` | `apps/brain-sdr/src/__tests__/unit/brain.test.ts` | ✅ green |
| 17-03-02 | 03 | 3 | D-06,D-07 | — | N/A | unit | `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` | `apps/brain-echo/src/__tests__/unit/brain.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All resolved during execution — no pending stubs.

- [x] `packages/ai/src/__tests__/unit/token.test.ts` — TOK-01/02: extractTokenUsage() helper (D-07) — 5 pass
- [x] `packages/ai/src/graph/state.test.ts` — TOK-03a/b/c: BrainStateAnnotation.tokenUsage reducer (D-07, D-06) — added to existing file
- [x] TokenUsage type (D-03) verified via TypeScript compilation in token.test.ts

> Note: `packages/ai/src/__tests__/unit/state-token.test.ts` exists and passes in isolation but
> has a Bun 1.3.2 module-cache isolation issue in multi-file runs. Equivalent coverage was added
> to `packages/ai/src/graph/state.test.ts` (TOK-03b, TOK-03c) which passes in all contexts.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resposta HTTP inclui `tokenUsage` com valores reais | D-09 | Requer LLM call real com provider | Enviar mensagem via webhook, verificar JSON de resposta contém `tokenUsage.totalTokens > 0` |
| Log Pino em consumer RabbitMQ contém `tokenUsage` | D-10 | Requer broker RabbitMQ ativo | Publicar mensagem na fila, verificar log estruturado contém campo `tokenUsage` |

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: all tasks covered
- [x] Wave 0 resolved: token.test.ts (TOK-01/02) + state.test.ts (TOK-03a/b/c)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-16

---

## Validation Audit 2026-06-16

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated | 0 |

### Resolution detail

| Gap | Task | Resolution |
|-----|------|------------|
| PARTIAL | 17-01-03 | TOK-03b/TOK-03c added to `packages/ai/src/graph/state.test.ts` — avoids Bun 1.3.2 module isolation bug |
| MISSING | 17-03-01 | TOK-07 added to `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — asserts tokenUsage from mock AIMessage with usage_metadata |
| MISSING | 17-03-02 | TOK-08 added to `apps/brain-echo/src/__tests__/unit/brain.test.ts` — same pattern |
