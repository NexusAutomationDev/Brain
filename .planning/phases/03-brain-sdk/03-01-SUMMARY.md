---
phase: "03-brain-sdk"
plan: "01"
subsystem: "core"
tags: ["brain-sdk", "registry", "interface", "tools", "tdd"]
dependency_graph:
  requires: ["03-00"]
  provides: ["IBrain interface", "BrainBuildContext type", "BrainRegistry", "ToolsRegistry"]
  affects: ["03-02", "03-03"]
tech_stack:
  added: []
  patterns: ["whitelist Map<brainType, Set<toolName>>", "fail-fast ConfigurationError", "StateGraph não compilado retornado por buildGraph()"]
key_files:
  created:
    - packages/core/src/brain/interface.ts
    - packages/core/src/brain/registry.ts
    - packages/core/src/tools/registry.ts
  modified:
    - packages/core/src/brain/__tests__/brain-registry.test.ts
    - packages/core/src/tools/__tests__/tools-registry.test.ts
decisions:
  - "IBrain.buildGraph() retorna StateGraph não compilado — BrainRunner chama .compile({ checkpointer }) (D-02)"
  - "ToolsRegistry lança ConfigurationError para brainType não registrado em vez de retornar [] silenciosamente (A3/D-12)"
  - "Stub mínimo de IBrain em testes não importa LangGraph diretamente — mantém testes rápidos e sem deps externas"
metrics:
  duration: "2 minutes"
  completed_date: "2026-06-12"
  tasks_completed: 2
  files_created: 3
  files_modified: 2
---

# Phase 03 Plan 01: IBrain Interface e Registries Summary

**One-liner:** IBrain contract com BrainBuildContext, BrainRegistry por id e ToolsRegistry com whitelist Map<brainType, Set<toolName>> — 8 testes TDD verdes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | IBrain interface e BrainRegistry (SDK-01) | a00a9ed | interface.ts, registry.ts, brain-registry.test.ts |
| 2 | ToolsRegistry (SDK-03) | 8c76e5a | tools/registry.ts, tools-registry.test.ts |

## What Was Built

### Task 1: IBrain Interface e BrainRegistry

**`packages/core/src/brain/interface.ts`** define dois contratos:

- `BrainBuildContext` — dependências injetadas pelo BrainRunner (llm, prompts, tools filtradas)
- `IBrain` — contrato mínimo de todo Brain: id, brainType, promptKeys, tools[], buildGraph()

`buildGraph()` retorna `StateGraph<typeof BrainStateAnnotation>` NÃO compilado — compilação é responsabilidade do BrainRunner (decisão D-02, alinha com AI-01).

**`packages/core/src/brain/registry.ts`** implementa `BrainRegistry`:
- `register(brain)` — armazena por id, lança `ConfigurationError` se duplicado
- `resolve(brainId)` — retorna IBrain por id, lança `ConfigurationError` se não encontrado

### Task 2: ToolsRegistry

**`packages/core/src/tools/registry.ts`** implementa `ToolsRegistry`:
- `enableTool(brainType, toolName)` — adiciona tool ao Set permitido para brainType
- `disableTool(brainType, toolName)` — remove tool do Set (no-op se não existe)
- `getTools(brainType, brainTools)` — filtra tools pelo whitelist; lança `ConfigurationError` se brainType não registrado

Padrão fail-fast: `getTools()` nunca retorna `[]` silenciosamente para brainType desconhecido — força detecção de misconfiguration no startup.

## Verification Results

```
bun test packages/core/src/brain packages/core/src/tools

 8 pass
 0 fail
 12 expect() calls
Ran 8 tests across 2 files. [136.00ms]
```

- BrainRegistry: 3 testes verdes (register/resolve/ConfigurationError)
- ToolsRegistry: 5 testes verdes (enable/disable/getTools/ConfigurationError)
- `grep -r 'MemorySaver' packages/core/src --include="*.ts" --exclude="*.test.ts"` → sem resultados (T-3-01-03 OK)

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None — sem dados hardcoded ou placeholders que bloqueiem o objetivo do plano.

## Threat Flags

Nenhuma superfície nova além do threat model documentado no plano.

## Self-Check: PASSED

- `packages/core/src/brain/interface.ts` — FOUND
- `packages/core/src/brain/registry.ts` — FOUND
- `packages/core/src/tools/registry.ts` — FOUND
- Commit a00a9ed — FOUND (Task 1)
- Commit 8c76e5a — FOUND (Task 2)
