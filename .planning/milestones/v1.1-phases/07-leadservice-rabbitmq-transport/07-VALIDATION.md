---
phase: 7
slug: leadservice-rabbitmq-transport
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-13
audited: 2026-06-14
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|------|--------|
| 7-01-01 | 01 | 1 | LEAD-02 | — | uniqueId nunca sobrescrito no update | unit | `cd packages/core && bun test src/leads` | `packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ green |
| 7-01-02 | 01 | 1 | LEAD-02 | — | segunda chamada com mesmo numero não duplica | unit | `cd packages/core && bun test src/leads` | `packages/core/src/leads/__tests__/lead-service.test.ts` | ✅ green |
| 7-01-03 | 01 | 1 | LEAD-03 | — | run() retorna null quando ia_ativada=false | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | `packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ green |
| 7-01-04 | 01 | 1 | LEAD-03 | — | LLM não é chamado quando ia_ativada=false | unit | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | `packages/core/src/runner/__tests__/brain-runner.test.ts` | ✅ green |
| 7-02-01 | 02 | 1 | TRP-01 | T-V5 | POST sem IDLead retorna 400 | unit | `cd packages/transport && bun test src/webhook/handler.test.ts` | `packages/transport/src/webhook/handler.test.ts` | ✅ green |
| 7-02-02 | 02 | 1 | TRP-03 | T-V5 | payload malformado via RabbitMQ vai para DLQ, não loop | unit | `cd packages/transport && bun test src/__tests__/unit/rabbitmq` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 7-02-03 | 02 | 1 | TRP-03 | — | mensagem válida chama runner.run() | unit | `cd packages/transport && bun test src/__tests__/unit/rabbitmq` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 7-02-04 | 02 | 1 | TRP-04 | — | start() lança ConfigurationError se RABBITMQ_URL ausente | unit | `cd packages/transport && bun test src/__tests__/unit/rabbitmq` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 7-02-05 | 02 | 2 | TRP-05 | T-DoS | após 3 falhas, mensagem publicada na DLQ + ACK | unit | `cd packages/transport && bun test src/__tests__/unit/rabbitmq` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 7-02-06 | 02 | 2 | TRP-05 | T-DoS | runner.run() não é chamado uma 4ª vez após 3 falhas | unit | `cd packages/transport && bun test src/__tests__/unit/rabbitmq` | `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | ✅ green |
| 7-02-07 | 02 | 2 | TRP-06 | — | createTransport("rabbitmq") retorna RabbitMQTransport | unit | `cd packages/transport && bun test src/factory.test.ts` | `packages/transport/src/factory.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Consumer se reconecta automaticamente após queda do RabbitMQ | TRP-05 | Requer container RabbitMQ real + kill/restart | `docker stop <rabbitmq>`, aguardar 5s, `docker start <rabbitmq>` — consumer deve reconectar sem restart do processo |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✅ nyquist_compliant

---

## Validation Audit 2026-06-14

| Metric | Count |
|--------|-------|
| Tasks audited | 11 |
| Gaps found | 0 |
| Resolved by auditor | 0 |
| Escalated to manual-only | 0 |
| Tests green | 11 |
| Tests red | 0 |

**Notes:**
- Todos os 11 requisitos tinham testes existentes e passando no momento da auditoria
- `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` difere do path original no plano (`src/rabbitmq/consumer.test.ts`) — conforme correção de convention CLAUDE.md documentada no 07-02-SUMMARY.md
- Integration tests em `brain-runner.integration.test.ts` são skipped sem `POSTGRES_URL` (comportamento esperado)
- Suite transport: **27 pass, 0 fail** · Suite core (unit): **16 pass, 0 fail**
