---
phase: 16-dynamic-responsemode
plan: "01"
subsystem: core/tools, shared/types
tags: [respond-tool, schema-as-tool, responseMode, zod-v4, tdd]
dependency_graph:
  requires: []
  provides:
    - createRespondTool factory (RESP-01)
    - ResponseMode type with "undefined" value (D-06)
    - ResponseModeSchema Zod with "undefined" in enum (D-07)
  affects:
    - packages/core/src/index.ts (barrel export)
    - packages/shared/src/types/index.ts (ResponseMode union)
    - packages/core/src/output/schema.ts (ResponseModeSchema enum)
tech_stack:
  added: []
  patterns:
    - Factory stateless para tool sem closure sobre sql (D-09)
    - Schema Zod v4 com superRefine para validação condicional co-dependente (D-03)
    - TDD: RED (teste falha) → GREEN (implementação) para cada task
key_files:
  created:
    - packages/core/src/tools/respond.ts
    - packages/core/src/tools/__tests__/respond.test.ts
  modified:
    - packages/shared/src/types/index.ts
    - packages/core/src/output/schema.ts
    - packages/core/src/__tests__/unit/output/schema.test.ts
    - packages/core/src/index.ts
decisions:
  - "createRespondTool é stateless (sem sql closure) — respond tool não toca banco; nó respond em brain.ts lê state.messages para extrair args (D-09)"
  - "ResponseMode inclui 'undefined' como primeira opção no union type — valor de fallback D-10 quando LLM não especifica formato (D-06)"
  - "responseMode enum da respond tool é ['undefined','text','audio'] — subconjunto de ResponseMode; 'image','video','document' não ficam no enum da tool (LLM sinaliza mídia via mediaType+mediaUrl, D-03)"
  - "z.string().url() para mediaUrl — PITFALL-5 mitigado; z.url() em Zod v4 é ZodURL, tipo diferente"
metrics:
  duration: "~3 minutos"
  completed: "2026-06-16"
  tasks_completed: 2
  files_created: 2
  files_modified: 4
---

# Phase 16 Plan 01: createRespondTool + ResponseMode "undefined" Summary

**One-liner:** Factory stateless `createRespondTool()` com schema Zod v4 e enum `responseMode: "undefined"` adicionado a `ResponseMode` e `ResponseModeSchema` para suporte ao fallback D-10.

## What Was Built

### Task 1: ResponseMode type + ResponseModeSchema — TDD GREEN

Adicionado `"undefined"` como primeiro valor no union `ResponseMode` em `packages/shared/src/types/index.ts` (D-06) e no enum `ResponseModeSchema` em `packages/core/src/output/schema.ts` (D-07).

`MODES_REQUIRING_MEDIA` permanece `["image", "video", "document"]` — `"undefined"` não exige mídia (D-08).

Novos testes adicionados em `schema.test.ts`:
- `BrainOutputSchema.parse({ fullResponse: "oi", responseMode: "undefined" })` não lança ZodError e retorna `responseMode === "undefined"` (fallback D-10)
- `ResponseModeSchema.parse("undefined")` retorna `"undefined"` sem erro (D-04)
- `ResponseModeSchema.parse("invalid_value")` lança ZodError (enum restrito)

**Resultado:** 13 testes passando (11 existentes + 2 novos)

### Task 2: createRespondTool() + testes + barrel export — TDD GREEN

Nova factory `createRespondTool()` criada em `packages/core/src/tools/respond.ts`:

- **Schema Zod v4:** `fullResponse` (string obrigatória), `responseMode` (enum `["undefined","text","audio"]`), `mediaType` (enum opcional `["image","file","video","audio"]`), `mediaUrl` (z.string().url() opcional)
- **superRefine:** validação condicional co-dependente — `mediaType` sem `mediaUrl` e vice-versa lançam ZodError com path correto (D-03)
- **Description:** contém "SEMPRE invoque" — instrução crítica para mitigar PITFALL-6 (LLM emitindo texto plano em vez de chamar a tool)
- **Stateless:** sem closure sobre sql — apenas loga via pino e retorna "ok" (D-09)

Barrel export adicionado em `packages/core/src/index.ts` sob SDK-07.

**Resultado:** 10 testes unitários passando (RESP-01 e RESP-02)

## Commits

| Task | Hash | Description |
|------|------|-------------|
| Task 1 | 61faf77 | feat(16-01): adicionar "undefined" ao ResponseMode e ResponseModeSchema |
| Task 2 | 5c76749 | feat(16-01): criar createRespondTool() com schema Zod v4 e testes unitários |

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| schema.test.ts | 13 | PASS |
| respond.test.ts | 10 | PASS |
| packages/core/ total | 98 pass, 2 fail | 2 falhas são pre-existentes (brain-runner.integration — DB indisponível em teste) |

## Decisions Made

1. **responseMode enum da respond tool = subconjunto restrito:** `["undefined","text","audio"]` — não inclui `"image"`, `"video"`, `"document"` pois mídia é sinalizada via `mediaType`+`mediaUrl`, não via responseMode na tool (D-03)
2. **createRespondTool é stateless:** diferente de `createPauseSessionTool` e `createFinishConversationTool`, não precisa de closure sobre sql — a tool não toca banco. O nó `respond` em brain.ts (próximo plano) lê `state.messages` para extrair os args invocados.
3. **z.string().url() — não z.url():** Em Zod v4, `z.url()` retorna `ZodURL` (tipo de validação de string isolada), enquanto `z.string().url()` retorna `ZodString` com validação de URL — necessário para compor com `.optional()` e para compatibilidade com a API de tools do LangChain (PITFALL-5).

## Pitfalls Mitigados

| Pitfall | Mitigação |
|---------|-----------|
| PITFALL-5 | `z.string().url()` usado para mediaUrl — não `z.url()` (tipo diferente em Zod v4) |
| PITFALL-6 | Description da tool contém "SEMPRE invoque" — instrução explícita para o LLM não emitir texto plano |

## Threat Model — Mitigações Implementadas

| Threat ID | Status | Implementação |
|-----------|--------|---------------|
| T-16-01 | MITIGATED | `z.string().url()` valida formato URI de mediaUrl |
| T-16-02 | ACCEPTED | fullResponse é conteúdo intencional do LLM para o usuário |
| T-16-03 | MITIGATED | Zod enum restrito + superRefine valida inputs do LLM antes de processar |
| T-16-04 | ACCEPTED | Tool executa em microsegundos (logger.info + return "ok") |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `createRespondTool()` está completamente implementada. O nó `respond` em brain.ts (que lê os args da tool invocada em `state.messages`) é escopo do próximo plano (16-02).

## Self-Check: PASSED

- [x] `packages/core/src/tools/respond.ts` existe
- [x] `packages/core/src/tools/__tests__/respond.test.ts` existe
- [x] Commits 61faf77 e 5c76749 existem
- [x] `bun test packages/core/src/tools/__tests__/respond.test.ts` → 10 pass
- [x] `bun test packages/core/src/__tests__/unit/output/schema.test.ts` → 13 pass
- [x] `grep -n "createRespondTool" packages/core/src/index.ts` → 1 linha
- [x] `grep -n "undefined" packages/shared/src/types/index.ts` → 2 linhas
