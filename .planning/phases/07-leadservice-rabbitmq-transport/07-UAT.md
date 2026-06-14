---
status: complete
phase: 07-leadservice-rabbitmq-transport
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md]
started: 2026-06-14T03:40:00Z
updated: 2026-06-14T04:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Start the Brain application from scratch. Process boots without errors, migrations complete, and a basic HTTP request (POST /api/v1/webhook with valid BrainEvent) returns a JSON response without crashing.
result: pass

### 2. Suite de testes — core + transport
expected: Running unit tests in packages/core and packages/transport completes with 0 failures.
result: pass
notes: 55 unit tests pass (core) + 24 tests pass (transport) = 79 total, 0 fail. Integration test fixed (wrong Drizzle field names: brain_type→brainType, value→content). Integration test passes when run standalone with correct env vars. Known Bun 1.3.x mock.module() leak causes it to fail when run together with unit tests — workaround: run integration tests separately (already supported via `bun test:integration`).

### 3. LeadService: upsert atômico preserva uniqueId
expected: Calling upsertLead twice with the same `numero` but different `uniqueId` values — the second call must NOT overwrite the original `uniqueId`.
result: pass
notes: Verified via unit tests (lead-service.test.ts) + integration test against real DB. onConflictDoUpdate set excludes uniqueId column — confirmed in implementation.

### 4. Gate ia_ativada — BrainRunner.run() retorna null
expected: When a lead has `ia_ativada = false`, calling BrainRunner.run() returns null and no LLM call is made.
result: pass
notes: Tested live via webhook: set ia_ativada=false in DB, POST returned {"status":"ignored"} HTTP 200. Reactivated cleanly.

### 5. WebhookTransport: POST sem IDLead retorna 400
expected: POST /api/v1/webhook missing IDLead returns HTTP 400 with "Invalid BrainEvent".
result: pass
notes: curl confirmed: {"error":"Invalid BrainEvent","details":{"fieldErrors":{"IDLead":["Required"]}}} HTTP 400

### 6. WebhookTransport: ia desativada retorna status "ignored"
expected: POST /api/v1/webhook where lead has ia_ativada=false returns HTTP 200 {"status":"ignored"}.
result: pass
notes: Verified live — set ia_ativada=false via DB, POST returned {"status":"ignored"} HTTP 200.

### 7. RabbitMQTransport: ConfigurationError sem ENVs
expected: createTransport("rabbitmq") + start() without RABBITMQ_URL throws ConfigurationError with clear message.
result: pass
notes: Threw: ConfigurationError - "RABBITMQ_URL, RABBITMQ_QUEUE e RABBITMQ_DLQ são obrigatórios para TRANSPORT=rabbitmq"

### 8. RabbitMQTransport: payload inválido vai para DLQ sem chamar runner
expected: RabbitMQ message without IDLead is sent to DLQ directly, runner.run() never called.
result: pass
notes: Verified via consumer.test.ts unit test — log shows {"bodyKeys":["Name","Message","Numero"],"msg":"Invalid BrainEvent from RabbitMQ — sending to DLQ"} (only key names, no values — CR-01 fix confirmed working).

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
