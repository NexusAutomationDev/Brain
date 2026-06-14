---
phase: 7
slug: leadservice-rabbitmq-transport
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (built-in, Bun 1.3.2) |
| **Config file** | Nenhum — `bun test` auto-descobre `*.test.ts` |
| **Quick run command** | `cd packages/core && bun test` ou `cd packages/transport && bun test` |
| **Full suite command** | `bun run test` (turbo — todos os pacotes) |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/<pacote> && bun test`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | LEAD-02 | — | uniqueId nunca sobrescrito no update | unit | `cd packages/core && bun test src/leads` | ❌ W0 | ⬜ pending |
| 7-01-02 | 01 | 1 | LEAD-02 | — | segunda chamada com mesmo numero não duplica | unit | `cd packages/core && bun test src/leads` | ❌ W0 | ⬜ pending |
| 7-01-03 | 01 | 1 | LEAD-03 | — | run() retorna null quando ia_ativada=false | unit | `cd packages/core && bun test src/runner` | ❌ W0 | ⬜ pending |
| 7-01-04 | 01 | 1 | LEAD-03 | — | LLM não é chamado quando ia_ativada=false | unit | `cd packages/core && bun test src/runner` | ❌ W0 | ⬜ pending |
| 7-02-01 | 02 | 1 | TRP-01 | T-V5 | POST sem IDLead retorna 400 | unit | `cd packages/transport && bun test src/webhook/handler.test.ts` | ❌ W0 | ⬜ pending |
| 7-02-02 | 02 | 1 | TRP-03 | T-V5 | payload malformado via RabbitMQ vai para DLQ, não loop | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ W0 | ⬜ pending |
| 7-02-03 | 02 | 1 | TRP-03 | — | mensagem válida chama runner.run() | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ W0 | ⬜ pending |
| 7-02-04 | 02 | 1 | TRP-04 | — | start() lança ConfigurationError se RABBITMQ_URL ausente | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ W0 | ⬜ pending |
| 7-02-05 | 02 | 2 | TRP-05 | T-DoS | após 3 falhas, mensagem publicada na DLQ + ACK | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ W0 | ⬜ pending |
| 7-02-06 | 02 | 2 | TRP-05 | T-DoS | runner.run() não é chamado uma 4ª vez após 3 falhas | unit | `cd packages/transport && bun test src/rabbitmq` | ❌ W0 | ⬜ pending |
| 7-02-07 | 02 | 2 | TRP-06 | — | createTransport("rabbitmq") retorna RabbitMQTransport | unit | `cd packages/transport && bun test src/factory.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/src/leads/__tests__/lead-service.test.ts` — stubs para LEAD-02 (mock sql/drizzle)
- [ ] `packages/core/src/runner/__tests__/brain-runner.test.ts` — adicionar testes gate ia_ativada (LEAD-03)
- [ ] `packages/transport/src/rabbitmq/consumer.test.ts` — stubs para TRP-03, TRP-04, TRP-05 (mock rabbitmq-client)
- [ ] `packages/transport/src/webhook/handler.test.ts` — adicionar teste TRP-01 (POST sem IDLead → 400)
- [ ] `packages/transport/src/factory.test.ts` — adicionar case "rabbitmq" test (TRP-06)

*Nota: handler.test.ts existente pode já ter teste de campo faltando — verificar antes de duplicar.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Consumer se reconecta automaticamente após queda do RabbitMQ | TRP-05 | Requer container RabbitMQ real + kill/restart | `docker stop <rabbitmq>`, aguardar 5s, `docker start <rabbitmq>` — consumer deve reconectar sem restart do processo |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
