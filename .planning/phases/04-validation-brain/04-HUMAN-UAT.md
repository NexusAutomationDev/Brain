---
status: approved
phase: 04-validation-brain
source: [04-VERIFICATION.md]
started: 2026-06-13T20:00:00Z
updated: 2026-06-13T21:00:00Z
---

## Current Test

[approved — all SC criteria met]

## Tests

### 1. SC-3: PostgresSaver durability across container restart
expected: Turn 2 reply references the CONTEXT_MARKER sent in turn 1, proving LangGraph loaded checkpoint from PostgreSQL after `docker restart`
result: PASSED

**Evidência:**
- Turno 1 (conversationId: sc3-persistence-test): `"Preciso que você guarde esta informação: meu código secreto é MARKER_BRAINCORE_42"`
- Container restartado: `docker restart brain-echo-test` → UP em < 5s
- Turno 2 (mesmo conversationId, sem mencionar o marcador): `"Pode resumir o que conversamos até agora?"`
- Resposta: *"você me passou um código secreto (MARKER_BRAINCORE_42) e pediu para que eu confirmasse o recebimento"*
- O LangGraph PostgresSaver restaurou o checkpoint do PostgreSQL corretamente após o restart.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
