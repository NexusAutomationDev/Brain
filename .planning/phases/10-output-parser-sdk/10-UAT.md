---
status: complete
phase: 10-output-parser-sdk
source:
  - 10-01-SUMMARY.md
  - 10-02-SUMMARY.md
  - 10-03-SUMMARY.md
  - 10-04-SUMMARY.md
  - 10-05-SUMMARY.md
started: 2026-06-15T16:00:00Z
updated: 2026-06-15T16:22:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Mate qualquer servidor rodando. Limpe estado efêmero (caches, locks). Suba o brain-echo do zero. O servidor deve iniciar sem erros, as migrations devem completar, e uma query básica (health check, POST /webhook, ou bun test básico) deve retornar dados reais sem crash.
result: pass
evidence: brain-echo Docker subiu do zero — migrations completed, BrainRunner initialized, porta 3000 listening. POST /webhook retornou `{ "status": "ok", "reply": "Olá! Tudo bem..." }` com resposta real do LLM.

### 2. BrainOutputSchema — suite unitária (9 testes)
expected: Rodar `bun test packages/core/src/__tests__/unit/output` retorna 9 testes passando, 0 falhas. Os casos cobrem todos os 5 valores de responseMode, e validam que image/video/document falham sem mediaType+mediaUrl enquanto text e audio passam sem eles.
result: pass
evidence: 9 pass, 0 fail — 152ms

### 3. BrainRunner — suite unitária (17 testes)
expected: Rodar `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` retorna 17 testes passando, 0 falhas. Inclui os cenários D-14 onde BrainOutputValidationError é lançado quando brainOutput é null ou não passa no schema Zod.
result: issue
reported: "1 falha no teste D-14: `.rejects.toThrow('BrainOutput')` — a mensagem da exceção null usava 'brainOutput' (minúsculo) e não continha 'BrainOutput' (PascalCase). O commit WR-03 endureceu a assertion mas a mensagem no runner.ts não foi ajustada para o caso null. O caso schema inválido (Zod) já passava pois a mensagem começa com 'BrainOutput schema validation failed'."
severity: major
fix_applied: "Mensagem alterada de 'Brain graph returned null brainOutput...' para 'BrainOutput is null — graph node must set state.brainOutput before __end__' em packages/core/src/runner/runner.ts:222. Após fix: 17 pass, 0 fail."

### 4. Handler diferencia BrainOutputValidationError (HTTP 502 vs 500)
expected: Rodar `bun test packages/transport/src` retorna 32 testes passando, 0 falhas. O teste D-14 confirma que quando o runner lança BrainOutputValidationError, o handler retorna status HTTP 502 com `{ error: "Brain output validation failed" }` — não 500.
result: pass
evidence: 51 pass, 0 fail (transport + shared + brain-echo unit juntos)

### 5. Webhook brain-echo — campo reply na resposta
expected: Iniciar o brain-echo e enviar POST /webhook com um payload de mensagem válido. A resposta HTTP 200 deve conter JSON com campo `reply` preenchido com a resposta do LLM (a API pública do webhook não sofre breaking change mesmo com a mudança interna para fullResponse).
result: pass
evidence: `POST /api/v1/webhook` retornou `{"status":"ok","reply":"Olá! Tudo bem, e com você? Como posso ajudar hoje?"}` — campo reply preservado, LLM respondeu com dados reais.

### 6. Suite completa — sem regressões
expected: Rodar suites unitárias completas retorna 68+ testes passando, 0 falhas (exceto as 2 falhas pré-existentes no brain-runner.integration.test.ts).
result: pass
evidence: 9 (output schema) + 17 (BrainRunner) + 51 (transport+shared+brain-echo) = 77 pass, 0 fail nas suites unitárias. Regressões pré-existentes em brain-runner.integration.test.ts confirmadas como anteriores a esta fase.

## Summary

total: 6
passed: 5
issues: 1
skipped: 0
blocked: 0
pending: 0

## Gaps

- truth: "BrainRunner lança BrainOutputValidationError quando brainOutput é null — erro contém substring 'BrainOutput'"
  status: fixed
  reason: "Mensagem do null check em runner.ts usava 'brainOutput' (camelCase) — assertion `.toThrow('BrainOutput')` (PascalCase) falhava. Corrigida a mensagem para iniciar com 'BrainOutput is null'"
  severity: major
  test: 3
  artifacts:
    - packages/core/src/runner/runner.ts:222
  fix_commit: pending
