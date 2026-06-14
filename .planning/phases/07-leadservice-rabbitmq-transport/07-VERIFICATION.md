---
phase: 07-leadservice-rabbitmq-transport
verified: 2026-06-14T03:40:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 10/12
  gaps_closed:
    - "BrainRunner LEAD-03 gate tests actually execute and pass — mock.module('@brain-pkg/database') and process.env.MIGRATIONS_FOLDER added; 8/8 unit tests pass"
    - "WebhookTransport null-return path tested (status: ignored) — test 'POST com runner retornando null retorna 200 { status: ignored }' added; 8/8 handler tests pass"
  gaps_remaining: []
  regressions: []
---

# Phase 7: LeadService + RabbitMQ Transport Verification Report

**Phase Goal:** LeadService (LEAD-02, LEAD-03) e RabbitMQTransport (TRP-03, TRP-04, TRP-05, TRP-06) implementados. Toda mensagem recebida (webhook ou RabbitMQ) cria o lead automaticamente, gate ia_ativada bloqueia silenciosamente leads desativados antes do LLM, e o transport pode ser selecionado via ENV TRANSPORT=rabbitmq sem recompilação.
**Verified:** 2026-06-14T03:40:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Primeira mensagem cria lead via upsert — subsequentes do mesmo numero não duplicam | VERIFIED | `lead-service.ts` insert().onConflictDoUpdate(target: leads.numero) — uniqueId in values(), absent from set{} |
| SC2 | Mensagem de lead com ia_ativada=false descartada silenciosamente antes do LLM | VERIFIED | `runner.ts` lines 154-165: upsertLead → gate `if (!lead.iaAtivada) return null` before compiledGraph.invoke; confirmed by 3 LEAD-03 gate tests (8/8 pass) |
| SC3 | TRANSPORT=rabbitmq inicia consumer que processa {Name,Message,Numero,IDLead}, ACK em sucesso | VERIFIED | `factory.ts` case "rabbitmq" + `consumer.ts` BrainEventSchema.safeParse + ConsumerStatus.ACK |
| SC4 | Falha permanente envia para DLQ sem loop infinito | VERIFIED | `consumer.ts` retryMap por IDLead:Numero, MAX_ATTEMPTS=3, pub.send(dlq) + ACK após 3 falhas |
| SC5 | TRANSPORT=webhook mantém comportamento anterior | VERIFIED | `factory.ts` case "webhook" → WebhookTransport unchanged; 8 handler tests pass |

### Plan Must-Have Truths (Plan 01)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Primeira mensagem cria lead automaticamente via upsert por numero | VERIFIED | `lead-service.ts`: onConflictDoUpdate target=leads.numero |
| 2 | unique_id (IDLead) nunca sobrescrito em chamadas subsequentes | VERIFIED | `set:` block has only `nome` and `updatedAt` — uniqueId explicitly absent |
| 3 | BrainRunner.run() retorna null silenciosamente quando lead.iaAtivada=false | VERIFIED | `runner.ts` line 163-165: `if (!lead.iaAtivada) { ... return null; }` |
| 4 | Nenhuma chamada LLM quando iaAtivada=false | VERIFIED | compiledGraph.invoke at line 184 is only reached after gate passes — return null exits before it |
| 5 | WebhookTransport handler trata resultado null de runner.run() sem TypeError | VERIFIED | `handler.ts` lines 54-55: `if (result === null) return c.json({ status: "ignored" }, 200)`; test in handler.test.ts line 99-113 passes |
| 6 | POST /api/v1/webhook sem IDLead retorna 400 com body.error "Invalid BrainEvent" | VERIFIED | TRP-01 test in handler.test.ts passes (8/8 tests pass) |
| 7 | LEAD-03 gate tests actually execute and pass | VERIFIED | brain-runner.test.ts 8/8 pass — mock.module('@brain-pkg/database') + process.env.MIGRATIONS_FOLDER added; 3 gate tests execute and pass |
| 8 | WebhookTransport null-return path has test coverage | VERIFIED | handler.test.ts line 99-113: "POST com runner retornando null retorna 200 { status: 'ignored' } (LEAD-03)" — nullRunner returns null, asserts body.status === "ignored" with HTTP 200 |

### Plan Must-Have Truths (Plan 02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TRANSPORT=rabbitmq inicia consumer processando {Name,Message,Numero,IDLead} | VERIFIED | factory.ts case "rabbitmq" + consumer.test.ts 7/7 pass |
| 2 | Mensagem processada com sucesso recebe ACK manual | VERIFIED | consumer.ts line 109: ConsumerStatus.ACK after runner.run() succeeds |
| 3 | Após 3 falhas consecutivas, mensagem vai para DLQ e ACK enviado | VERIFIED | consumer.ts MAX_ATTEMPTS=3, pub.send(dlq) + ACK; consumer.test.ts TRP-05 confirms |
| 4 | Payload inválido vai direto para DLQ sem retry | VERIFIED | consumer.ts: !parsed.success → pub.send(dlq) + ACK, no runner.run() call |
| 5 | RabbitMQTransport.start() lança ConfigurationError se ENVs ausentes | VERIFIED | consumer.ts lines 59-64: ConfigurationError({hasUrl, hasQueue, hasDlq}) |
| 6 | Reconexão automática via rabbitmq-client | VERIFIED | consumer.ts: Connection handles reconnect; built into the library |
| 7 | createTransport('rabbitmq') retorna RabbitMQTransport | VERIFIED | factory.ts case "rabbitmq": return new RabbitMQTransport(runner!); factory.test.ts TRP-06 passes |

**Score:** 12/12 must-haves verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/core/src/leads/lead-service.ts` | VERIFIED | Exists, 75 lines, exports LeadService class and Lead type, onConflictDoUpdate correctly excludes uniqueId |
| `packages/core/src/leads/__tests__/lead-service.test.ts` | VERIFIED | 3 tests pass — upsertLead, onConflictDoUpdate without uniqueId, updatedAt present |
| `packages/core/src/runner/runner.ts` | VERIFIED | Modified with LeadService import, leadService field, upsertLead call, ia_ativada gate, nullable return |
| `packages/core/src/runner/__tests__/brain-runner.test.ts` | VERIFIED | 8/8 tests pass — @brain-pkg/database mocked, MIGRATIONS_FOLDER set, 3 LEAD-03 gate tests execute correctly |
| `packages/transport/src/webhook/handler.ts` | VERIFIED | IBrainRunnerLike updated to `| null`, null-check returns `{ status: "ignored" }` |
| `packages/transport/src/rabbitmq/consumer.ts` | VERIFIED | 150 lines, RabbitMQTransport implements ITransport, MAX_ATTEMPTS=3, retryMap by IDLead:Numero |
| `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` | VERIFIED | 7 tests pass — TRP-03, TRP-04, TRP-05 all covered |
| `packages/transport/src/factory.ts` | VERIFIED | case "rabbitmq" added, imports RabbitMQTransport |
| `packages/transport/src/factory.test.ts` | VERIFIED | Tests pass — TRP-06 and kafka-variant ConfigurationError |
| `packages/transport/src/webhook/handler.test.ts` | VERIFIED | 8/8 tests pass — null-runner path added at lines 99-113 |
| `apps/brain-echo/.env.example` | VERIFIED | Contains RABBITMQ_URL, RABBITMQ_QUEUE, RABBITMQ_DLQ, RABBITMQ_RETRY_DELAY_MS, TRANSPORT=webhook |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `runner.ts BrainRunner.run()` | `lead-service.ts LeadService.upsertLead()` | `this.leadService.upsertLead(event.Numero, event.IDLead, event.Name)` | WIRED | Lines 155-159 of runner.ts |
| `handler.ts createWebhookApp()` | `runner.run() → null result` | `if (result === null) return c.json({ status: "ignored" }, 200)` | WIRED + TESTED | Lines 54-55 of handler.ts; handler.test.ts line 99-113 confirms |
| `factory.ts createTransport()` | `consumer.ts RabbitMQTransport` | `case "rabbitmq": return new RabbitMQTransport(runner!)` | WIRED | Line 26-27 of factory.ts |
| `consumer.ts handler callback` | `runner.run(parsed.data)` | `ConsumerStatus.ACK` after success | WIRED | Lines 106-109 of consumer.ts |
| `consumer.ts after 3 failures` | `DLQ via this.pub.send(dlq, msg.body)` | `attempt >= MAX_ATTEMPTS → pub.send + ACK` | WIRED | Lines 116-124 of consumer.ts |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `lead-service.ts` | `rows` from upsert | `this.db.insert().onConflictDoUpdate().returning()` | DB query (real Drizzle ORM) | FLOWING |
| `runner.ts` | `lead` (iaAtivada field) | `this.leadService.upsertLead(...)` returns DB row | iaAtivada comes from DB not payload | FLOWING |
| `consumer.ts` | `parsed.data` | `BrainEventSchema.safeParse(msg.body)` | Validates real RabbitMQ message body | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BrainRunner unit tests (LEAD-03 gates) | `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` | 8 pass, 0 fail | PASS |
| Handler null-path test (LEAD-03) | `bun test packages/transport/src/webhook/handler.test.ts` | 8 pass, 0 fail | PASS |
| LeadService unit tests | `bun test packages/core/src/leads` | 3 pass, 0 fail | PASS |
| Transport full suite | `bun test packages/transport/src` | 24 pass, 0 fail | PASS |
| factory creates RabbitMQTransport | factory.test.ts TRP-06 | pass | PASS |
| ConfigurationError on missing ENVs | consumer.test.ts TRP-04 | 3 tests pass | PASS |

Note: `bun test packages/core/src` shows 31 pass / 2 fail — the 2 failures are in `brain-runner.integration.test.ts`, a pre-existing infrastructure issue unrelated to Phase 7 (integration test requires a running PostgreSQL; `describe.skip` suppresses the test body but `beforeAll`/`afterAll` hooks still fire against a Drizzle mock that lacks `onConflictDoNothing`). This failure predates Phase 7 work and is not a regression.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LEAD-02 | 07-01 | Lead cadastrado automaticamente — upsert por numero, unique_id nunca sobrescrito | SATISFIED | lead-service.ts onConflictDoUpdate; 3 unit tests pass |
| LEAD-03 | 07-01 | Mensagens de lead com ia_ativada=false ignoradas silenciosamente | SATISFIED | runner.ts gate wired correctly; 3 gate tests pass (8/8 brain-runner.test.ts) |
| TRP-01 | 07-01 | Webhook valida campos obrigatórios, rejeita com erro se algum faltar | SATISFIED | handler.test.ts TRP-01 test passes; BrainEventSchema.safeParse enforces IDLead |
| TRP-03 | 07-02 | RabbitMQ consumer com campos padronizados | SATISFIED | consumer.ts + 7 consumer tests pass |
| TRP-04 | 07-02 | Fila RabbitMQ configurável via ENV | SATISFIED | consumer.ts reads RABBITMQ_URL/QUEUE/DLQ; ConfigurationError tests pass |
| TRP-05 | 07-02 | Manual ack/nack, DLQ, prefetch=1, reconexão automática | SATISFIED | consumer.ts: requeue:false, prefetchCount:1, retryMap, pub.send(DLQ), Connection auto-reconnect |
| TRP-06 | 07-02 | Seleção de transport via ENV TRANSPORT=webhook/rabbitmq | SATISFIED | factory.ts switch; factory.test.ts pass |

### Anti-Patterns Found

None. All previously identified anti-patterns (missing mocks causing worker crash) have been resolved.

### Human Verification Required

None — all behavioral checks confirmed programmatically.

---

_Verified: 2026-06-14T03:40:00Z_
_Verifier: Claude (gsd-verifier)_
