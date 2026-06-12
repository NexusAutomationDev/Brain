---
status: partial
phase: 03-brain-sdk
source: [03-VERIFICATION.md]
started: 2026-06-12T00:00:00Z
updated: 2026-06-12T00:00:00Z
---

## Current Test

[aguardando testes humanos]

## Tests

### 1. BrainRunner end-to-end com PostgreSQL real
expected: init() conecta ao banco, carrega prompts via loadPrompts(), compila grafo com PostgresSaver e MemoryManager; run(event) retorna { reply: string } com a resposta do LLM; memória persiste entre chamadas via thread_id
result: [pending]

### 2. POST /reload-prompts autenticação
expected: sem X-Admin-Token → 401; token errado → 401; ADMIN_TOKEN não configurado → 503; token correto → 200 e runner.refreshPrompts() chamado
result: [pending]

### 3. WebhookHandler com runner injetado
expected: POST /webhook com runner injetado dispara runner.run(event) e retorna { status: 'ok', reply: string }; sem runner retorna { status: 'accepted' }
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
