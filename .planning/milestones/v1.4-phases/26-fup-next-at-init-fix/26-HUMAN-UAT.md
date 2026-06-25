---
status: passed
phase: 26-fup-next-at-init-fix
source: [26-VERIFICATION.md]
started: 2026-06-25T04:12:00Z
updated: 2026-06-25T04:14:30Z
---

## Current Test

Concluído — verificação E2E executada contra banco brain_test real.

## Tests

### 1. Flow FUP Activation E2E
expected: Com banco PostgreSQL real e fup_config populada (enabled=true, intervals_seconds=[60], minHour=0, maxHour=23, allowedDays=todos, timezone='America/Sao_Paulo'):
1. upsertLead() INSERT popula fup_next_at com Date no futuro (~60s)
2. Após SET fup_next_at = NOW() - 2s, lead elegível para scheduler
3. Query WHERE fup_enabled=true AND fup_next_at<=NOW() AND ia_ativada=true retorna o lead
4. UPDATE path não altera fup_next_at (INSERT-only por design)
result: passed — todos os 4 checks passaram contra brain_test

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
