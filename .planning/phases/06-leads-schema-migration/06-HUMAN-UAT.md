---
status: passed
phase: 06-leads-schema-migration
source: [06-VERIFICATION.md]
started: 2026-06-14T01:46:20Z
updated: 2026-06-14T01:52:00Z
---

## Current Test

Concluído — 2/2 testes passaram via execução automatizada em brain_test.

## Tests

### 1. Brain inicializa contra banco vazio
expected: `runMigrations()` cria a tabela `leads` em banco limpo sem erros — tabela deve existir após init() e Brain deve aceitar mensagens normalmente
result: passed — tabela `leads` criada com 8 colunas corretas (uuid, unique_id, nome, numero, ia_ativada, fullpp, created_at, updated_at) e UNIQUE INDEX `leads_numero_unique_idx` em `numero`

### 2. Advisory lock serializa duas instâncias concorrentes
expected: Segunda instância fica bloqueada aguardando enquanto a primeira executa migrations; ao liberar o lock, a segunda prossegue (mas as migrations já estão aplicadas) sem erros
result: passed — instância 1 adquiriu lock, completou em 110ms e liberou; instância 2 aguardou e adquiriu o lock somente após liberação, completando em 78ms sem erros

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
