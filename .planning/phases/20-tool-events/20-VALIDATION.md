---
phase: 20
slug: tool-events
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in) |
| **Config file** | none — `bun test src` em `package.json` do core |
| **Quick run command** | `bun test packages/core/src/events` |
| **Full suite command** | `bun test packages/core/src` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/core/src/events`
- **After every plan wave:** Run `bun test packages/core/src`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 0 | EVT-01 | — | publish() absorve erros silenciosamente (nunca lança) | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-02 | 01 | 0 | EVT-02 | — | whitelist hardcoded rejeita tools fora do escopo | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ❌ W0 | ⬜ pending |
| 20-01-03 | 01 | 0 | EVT-04 | — | event_id = threadId:tool_call_id (idempotente) | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ❌ W0 | ⬜ pending |
| 20-02-01 | 02 | 1 | EVT-01 | — | run() não await publish() — não bloqueia resposta | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ existe (modificar) | ⬜ pending |
| 20-02-02 | 02 | 1 | EVT-01 | — | sem ENV = sem publicação, BrainRunner funciona normal | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ existe (adicionar casos) | ⬜ pending |
| 20-02-03 | 02 | 1 | EVT-01 | — | RabbitMQ tem prioridade quando ambos ENVs configurados | unit | `bun test packages/core/src/events/__tests__/unit/event-publisher.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/events/event-publisher.ts` — implementação de IEventPublisher, EventPublisher, NoopEventPublisher, ToolEvent
- [ ] `packages/core/src/events/__tests__/unit/event-publisher.test.ts` — stubs para EVT-01 (webhook), EVT-01 (rabbitmq), EVT-01 (disabled), EVT-02, EVT-04

*Existing infrastructure (bun test, __tests__/unit/) covers framework — only new files needed for this phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ToolMessage.name = nome da tool no invoke() real | EVT-02 | Assumption A3 — não verificado via teste de integração com grafo real | Inspecionar estado retornado por compiledGraph.invoke() com uma conversa real que dispare qualify_lead; confirmar msg.name === "qualify_lead" |
| RabbitMQ publisher recebe mensagem na fila configurada | EVT-01 | Requer RabbitMQ em execução | Configurar TOOL_EVENTS_QUEUE + RABBITMQ_URL; enviar mensagem ao Brain; confirmar evento na fila via rabbitmq management |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
