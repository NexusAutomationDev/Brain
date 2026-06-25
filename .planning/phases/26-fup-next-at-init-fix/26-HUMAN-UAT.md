---
status: partial
phase: 26-fup-next-at-init-fix
source: [26-VERIFICATION.md]
started: 2026-06-25T04:12:00Z
updated: 2026-06-25T04:12:00Z
---

## Current Test

[aguardando verificação humana]

## Tests

### 1. Flow FUP Activation E2E
expected: Com banco PostgreSQL real e fup_config populada (enabled=true, intervals_seconds=[3600], minHour=8, maxHour=18, allowedDays=['mon'...'fri'], timezone='America/Sao_Paulo'):
1. Criar novo lead via BrainRunner.run() com evento de primeira mensagem
2. Verificar que leads.fup_next_at foi preenchido com Date ~1 hora à frente (ajustado para business hours)
3. Atualizar manualmente fup_next_at para NOW() - 1 second para não aguardar o intervalo completo
4. Verificar que o próximo tick do FupScheduler seleciona o lead e envia o FUP
5. Verificar publicação de evento EVT-03 no canal configurado
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
