---
status: partial
phase: 09-brain-sdr
source: [09-VERIFICATION.md]
started: 2026-06-14T21:00:00-03:00
updated: 2026-06-14T21:00:00-03:00
---

## Current Test

[aguardando testes humanos com infraestrutura real]

## Tests

### 1. Processamento E2E de mensagem (SDR-01)
expected: Enviar webhook com todas as ENVs e LLM provider real. Brain responde com mensagem no tom do system prompt armazenado no banco.
result: [pending]

### 2. Gate ia_ativada (SDR-02)
expected: Inserir lead com `ia_ativada=false`, enviar mensagem webhook. BrainRunner.run() retorna null, sem chamada LLM, log mostra gate ativado.
result: [pending]

### 3. Persistência e recuperação de histórico (SDR-03)
expected: Enviar 2 mensagens do mesmo lead, depois uma 3ª. Tabela checkpoint LangGraph persiste histórico; 3ª resposta tem acesso ao contexto anterior.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
