---
status: partial
phase: 22-fup-autom-tico
source: [22-VERIFICATION.md]
started: 2026-06-24T02:25:00Z
updated: 2026-06-24T02:25:00Z
---

## Current Test

[aguardando testes humanos]

## Tests

### 1. Schema push — coluna fup_failure_count no banco real
expected: psql retorna `fup_failure_count | integer | not null | default 0` na tabela leads
result: [pending]

### 2. Runtime startup — FupScheduler inicia com FUP_WEBHOOK_URL configurado
expected: log `{ hasFupUrl: true, msg: "FupScheduler started" }` aparece no console ao iniciar o Brain com FUP_WEBHOOK_URL setado
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
