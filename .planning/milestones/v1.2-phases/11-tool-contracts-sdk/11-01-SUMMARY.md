---
phase: 11-tool-contracts-sdk
plan: "01"
subsystem: core-sdk
tags: [tool-contracts, brain-build-context, tools-registry, lead-service, tdd, wave-0]
dependency_graph:
  requires: []
  provides:
    - BrainBuildContext.sql opcional (interface.ts)
    - ToolsRegistry.enableTool() com guard BRAIN_TOOLS
    - LeadService.setFullpp(uniqueId, value)
    - LeadService.setIaAtivada(uniqueId, value)
    - Testes scaffold Wave 0 para pause_session e finish_conversation
  affects:
    - packages/core (brain SDK)
    - Fase 12 (consumidora das factories de tool e dos métodos do LeadService)
tech_stack:
  added: []
  patterns:
    - Guard ENV em enableTool() — whitelist CSV lida em runtime (D-07/D-08/D-09)
    - Campo opcional em interface para backward compatibility (D-01)
    - TDD Wave 0: testes RED antes da implementação
key_files:
  created:
    - packages/core/src/tools/__tests__/pause-session.test.ts
    - packages/core/src/tools/__tests__/finish-conversation.test.ts
  modified:
    - packages/core/src/brain/interface.ts
    - packages/core/src/tools/registry.ts
    - packages/core/src/leads/lead-service.ts
    - packages/core/src/tools/__tests__/tools-registry.test.ts
    - packages/core/src/leads/__tests__/lead-service.test.ts
decisions:
  - "D-01: sql?: Sql opcional em BrainBuildContext — não quebra brain-echo nem brain-sdr"
  - "D-07: enableTool() silencioso quando BRAIN_TOOLS filtra — sem log, sem erro"
  - "D-08: BRAIN_TOOLS ausente = comportamento inalterado (TOOLS-ENV-02)"
  - "D-09: parse CSV com .trim() para tolerar espaços acidentais"
metrics:
  duration: "7 minutes"
  completed_date: "2026-06-15"
  tasks_completed: 2
  files_changed: 7
---

# Phase 11 Plan 01: Tool Contracts SDK — Foundation Summary

**One-liner:** BrainBuildContext ganha `sql?: Sql`, `enableTool()` filtra por `BRAIN_TOOLS` CSV com fallback zero-breaking, e `LeadService` ganha `setFullpp`/`setIaAtivada` — mais testes scaffold RED para Wave 2.

## What Was Built

### Task 1: Wave 0 Scaffolds (RED)

Criados 2 novos arquivos de teste e ampliados 2 existentes:

| Arquivo | Status | Testes |
|---------|--------|--------|
| `pause-session.test.ts` | RED (Cannot find module) | 4 casos TOOLS-STD-01 |
| `finish-conversation.test.ts` | RED (Cannot find module) | 4 casos TOOLS-STD-02 |
| `tools-registry.test.ts` | 5 originais pass + 4 novos RED | TOOLS-ENV-01/02 + D-09 |
| `lead-service.test.ts` | 3 originais pass + 2 novos RED | setFullpp, setIaAtivada |

Os testes de `pause-session` e `finish-conversation` falham com `Cannot find module '../pause-session.js'` e `'../finish-conversation.js'` — estado RED correto para Wave 0 (os arquivos de implementação serão criados no Plan 02).

Os testes existentes de `tools-registry` e `lead-service` falharam por métodos/guard não existentes — também estado RED esperado antes da Task 2.

### Task 2: Implementação dos 3 artefatos

**`packages/core/src/brain/interface.ts`**
- Adicionado `import type { Sql } from "postgres"` 
- Adicionado `sql?: Sql` ao `BrainBuildContext` (campo opcional — D-01)

**`packages/core/src/tools/registry.ts`**
- Guard `BRAIN_TOOLS` inserido no início de `enableTool()` (antes de qualquer mutação)
- Parse CSV: `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())`
- Quando `BRAIN_TOOLS` definido e tool não está na lista: `return` silencioso (D-07)
- Quando `BRAIN_TOOLS` ausente: bypass total, comportamento inalterado (D-08)

**`packages/core/src/leads/lead-service.ts`**
- `setFullpp(uniqueId, value)`: UPDATE atômico em `leads.fullpp` por `uniqueId`
- `setIaAtivada(uniqueId, value)`: UPDATE atômico em `leads.iaAtivada` por `uniqueId`
- Ambos incluem `updatedAt: new Date()` no SET

## Test Results

```
bun test packages/core/src/tools/__tests__/tools-registry.test.ts
  9/9 pass (5 originais + 4 BRAIN_TOOLS)

bun test packages/core/src/leads/__tests__/lead-service.test.ts
  5/5 pass (3 originais + 2 update methods)

bun test packages/core/src/tools/__tests__/pause-session.test.ts
  RED — Cannot find module '../pause-session.js' (esperado Wave 0)

bun test packages/core/src/tools/__tests__/finish-conversation.test.ts
  RED — Cannot find module '../finish-conversation.js' (esperado Wave 0)

bun run build (turbo — todos os 9 pacotes)
  9 successful, 0 errors
```

## Commits

| Task | Hash | Mensagem |
|------|------|----------|
| Task 1 | `c2fff5d` | `test(11-01): scaffold Wave 0 — testes RED para tool contracts SDK` |
| Task 2 | `13298a6` | `feat(11-01): BrainBuildContext sql?, BRAIN_TOOLS guard, LeadService update methods` |

## Decisions Made

1. **D-01 — `sql?: Sql` opcional:** Campo marcado como opcional no `BrainBuildContext` — brain-echo e brain-sdr existentes não precisam passar `sql` e continuam compilando sem alteração.

2. **D-07 — Guard silencioso:** `enableTool()` retorna silenciosamente quando a tool não está na whitelist. Sem log, sem erro. Previne enumeração de tools disponíveis.

3. **D-08 — Backward compatibility total:** `BRAIN_TOOLS` ausente = `envWhitelist` é `undefined` = bypass total = comportamento inalterado. Zero impacto em deployments existentes.

4. **D-09 — Parse CSV com `.trim()`:** `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())` tolera espaços ao redor dos nomes (`" pause_session , finish_conversation "`).

## Deviations from Plan

### Auto-fixed Issues

Nenhum — plano executado exatamente conforme especificado.

### Notas de Implementação

- O teste de `lead-service.test.ts` para `setFullpp`/`setIaAtivada` injeta `mockUpdate2` diretamente no `mockDb` compartilhado (mesmo objeto retornado pelo mock de `drizzle`). Esta é a abordagem correta para o padrão de mock de Bun — sem `require()` dinâmico.
- O build falhou inicialmente porque os pacotes dependentes (`@brain-pkg/shared`, `@brain-pkg/database`, etc.) não tinham seus `dist/` gerados no worktree. Resolvido rodando `bun run build` a partir da raiz (turbo constrói na ordem correta de dependências).

## Known Stubs

Nenhum — todos os artefatos desta wave são código de produção completo ou testes scaffold deliberadamente RED.

## Threat Flags

Nenhuma superfície nova além do que está no `<threat_model>` do plano:
- `BRAIN_TOOLS` guard já estava no threat register (T-11-01, T-11-03)
- Novos métodos `setFullpp`/`setIaAtivada` não introduzem endpoints ou caminhos de auth novos

## Self-Check: PASSED

### Files Exist

- FOUND: `packages/core/src/tools/__tests__/pause-session.test.ts`
- FOUND: `packages/core/src/tools/__tests__/finish-conversation.test.ts`
- FOUND: `packages/core/src/brain/interface.ts`
- FOUND: `packages/core/src/tools/registry.ts`
- FOUND: `packages/core/src/leads/lead-service.ts`

### Commits Exist

- FOUND: `c2fff5d` — test(11-01): scaffold Wave 0
- FOUND: `13298a6` — feat(11-01): BrainBuildContext sql?, BRAIN_TOOLS guard, LeadService update methods
