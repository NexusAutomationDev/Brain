---
phase: 12-brain-sdr-integration
plan: "02"
subsystem: transport
tags: [webhook, brain-output, breaking-change, parser]
dependency_graph:
  requires:
    - "12-01: BrainOutput SDK (fullResponse, responseMode) — contrato de saída do BrainRunner"
  provides:
    - "handler.ts retornando BrainOutput completo via POST /api/v1/webhook"
    - "handler.test.ts verificando novo contrato — body.fullResponse, body.responseMode, body.reply undefined"
  affects:
    - "Downstream consumers do webhook (WhatsApp/CRM) — precisam migrar de body.reply para body.fullResponse"
tech_stack:
  added: []
  patterns:
    - "Spread condicional (...(x && { key: x })) para campos opcionais na resposta JSON"
    - "TDD RED→GREEN: teste antigo falhou com handler atualizado, depois atualizado para novo contrato"
key_files:
  modified:
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/webhook/handler.test.ts
decisions:
  - "D-01/D-02 confirmados: breaking change intencional — campo reply removido sem backward-compat shim"
  - "mediaType e mediaUrl incluídos condicionalmente via spread — ausentes da resposta quando null/undefined"
metrics:
  duration: "~8 min"
  completed: "2026-06-15"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 12 Plan 02: Webhook BrainOutput Response — Summary

**One-liner:** Webhook retorna BrainOutput completo (`fullResponse`, `responseMode`, `mediaType?`, `mediaUrl?`) removendo o campo legado `reply` — breaking change D-01/D-02.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Atualizar handler.ts — resposta BrainOutput completa | b49a1cf | packages/transport/src/webhook/handler.ts |
| 2 | Atualizar handler.test.ts — assertions novo contrato | f160df1 | packages/transport/src/webhook/handler.test.ts |

## What Was Built

O handler do webhook (`POST /api/v1/webhook`) foi atualizado para retornar o shape `BrainOutput` completo em vez do campo legado `reply`:

**Antes:**
```json
{ "status": "ok", "reply": "Olá! Posso te ajudar." }
```

**Depois:**
```json
{ "status": "ok", "fullResponse": "Olá! Posso te ajudar.", "responseMode": "text" }
```

Campos `mediaType` e `mediaUrl` são incluídos condicionalmente via spread quando presentes no resultado do runner.

O teste correspondente foi atualizado para verificar:
- `body.fullResponse` é string com o valor correto
- `body.responseMode` é `"text"`
- `body.reply` é `undefined` (campo removido)

## Verification

```
bun test packages/transport/src/webhook/handler.test.ts
8 pass, 0 fail, 18 expect() calls
```

Todos os 8 test cases passam, incluindo:
- POST sem runner → `{ status: "accepted" }`
- POST com runner → `{ status: "ok", fullResponse, responseMode }` (novo contrato)
- POST com runner retornando null → `{ status: "ignored" }`
- Casos de autenticação, validação de body, IDLead ausente

## Deviations from Plan

### Auto-fixed Issues

Nenhuma issue auto-corrigida.

### Deviations

**1. Symlinks de node_modules para execução de testes no worktree**
- **Found during:** Task 2 (verificação RED phase)
- **Issue:** Worktree não tem node_modules instalados; Bun resolve dependências relativo ao arquivo em execução, não ao cwd
- **Fix:** Criados symlinks `packages/transport/node_modules`, `packages/observability/node_modules`, `packages/shared/node_modules` apontando para os node_modules do root real `/root/Brain`
- **Arquivos:** symlinks (não commitados — gerados em runtime pelo setup do worktree)
- **Impacto:** Nenhum no código de produção; apenas infraestrutura de execução de testes no worktree

## Success Criteria Verification

- [x] `packages/transport/src/webhook/handler.ts` retorna `{ status: "ok", fullResponse, responseMode, mediaType?, mediaUrl? }` — campo `reply` removido
- [x] `packages/transport/src/webhook/handler.test.ts` verifica `body.fullResponse`, `body.responseMode`, e `body.reply === undefined`
- [x] `bun test handler.test.ts` passa verde (8/8)
- [x] Todos os outros cases (null result, sem runner, auth failures, invalid body) continuam passando

## Known Stubs

Nenhum stub presente. Dados fluem diretamente do runner para a resposta.

## Threat Flags

Nenhuma nova superfície de ataque introduzida. Mitigações T-12-02-03 (auth) e T-12-02-04 (input validation) confirmadas intactas no handler.ts.
