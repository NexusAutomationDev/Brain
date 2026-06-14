---
status: partial
phase: 08-brainrunner-conversation-history
source: [08-VERIFICATION.md]
started: 2026-06-14T19:00:00Z
updated: 2026-06-14T19:00:00Z
---

## Current Test

[aguardando teste humano]

## Tests

### 1. Integration tests com PostgreSQL real

expected: HIST-00, HIST-01 e HIST-02 passam com `TEST_DB_URL` apontando para banco real. HIST-01 asserta `msgCount2 > 1` (mesmo IDLead com Numeros diferentes compartilha o mesmo checkpoint). HIST-02 asserta `msgCount2 > msgCount1` (histórico acumula entre chamadas).

Comando: `TEST_DB_URL=<url> bun test packages/core/src/runner/__tests__/brain-runner.integration.test.ts`

result: [pending]

### 2. Comportamento end-to-end com lead real

expected: Enviar duas mensagens via webhook com mesmo IDLead mas Numeros diferentes contra um Brain rodando com PostgreSQL. A segunda resposta deve refletir o contexto da primeira conversa (msgCount encoding na reply indica histórico acumulado).

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
