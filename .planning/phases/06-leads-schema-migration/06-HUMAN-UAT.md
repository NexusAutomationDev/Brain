---
status: partial
phase: 06-leads-schema-migration
source: [06-VERIFICATION.md]
started: 2026-06-14T01:46:20Z
updated: 2026-06-14T01:46:20Z
---

## Current Test

[aguardando testes humanos]

## Tests

### 1. Brain inicializa contra banco vazio
expected: `runMigrations()` cria a tabela `leads` em banco limpo sem erros — tabela deve existir após init() e Brain deve aceitar mensagens normalmente
result: [pending]

### 2. Advisory lock serializa duas instâncias concorrentes
expected: Segunda instância fica bloqueada aguardando enquanto a primeira executa migrations; ao liberar o lock, a segunda prossegue (mas as migrations já estão aplicadas) sem erros
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
