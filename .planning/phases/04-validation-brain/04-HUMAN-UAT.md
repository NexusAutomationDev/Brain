---
status: partial
phase: 04-validation-brain
source: [04-VERIFICATION.md]
started: 2026-06-13T20:00:00Z
updated: 2026-06-13T20:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. SC-3: PostgresSaver durability across container restart
expected: Turn 2 reply references the CONTEXT_MARKER sent in turn 1, proving LangGraph loaded checkpoint from PostgreSQL after `docker restart`
result: [pending]

**Como testar:**
```bash
ECHO_URL=http://localhost:3000 ECHO_CONTAINER_NAME=brain-echo-test bun test apps/brain-echo/src/__tests__/integration/restart.test.ts
```

Ou manualmente:
```bash
# Turno 1: enviar mensagem com marcador único
curl -s -X POST http://localhost:3000/api/v1/webhook \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: sc3-turn1" \
  -d '{"conversationId":"sc3-conv","stepIndex":0,"userId":"tester","content":"Lembre: MARKER_12345"}'

# Restart do container
docker restart brain-echo-test && sleep 10

# Turno 2: verificar que o contexto foi preservado
curl -s -X POST http://localhost:3000/api/v1/webhook \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: sc3-turn2" \
  -d '{"conversationId":"sc3-conv","stepIndex":1,"userId":"tester","content":"Qual marker eu mencionei antes?"}'
```
Esperado: resposta menciona "MARKER_12345"

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
