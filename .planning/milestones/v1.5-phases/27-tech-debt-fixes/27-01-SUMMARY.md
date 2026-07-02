---
phase: 27-tech-debt-fixes
plan: "01"
subsystem: core/tools-registry + brain-sdr
tags: [tech-debt, brain-tools, whitelist, tools-registry, brain-build-context]
dependency_graph:
  requires: []
  provides:
    - BrainBuildContext.enabledTools
    - ToolsRegistry.getEnvWhitelist()
    - brain-sdr filteredAllTools
  affects:
    - packages/core/src/brain/interface.ts
    - packages/core/src/tools/registry.ts
    - packages/core/src/runner/runner.ts
    - apps/brain-sdr/src/brain.ts
tech_stack:
  added: []
  patterns:
    - enabledTools whitelist flow: ToolsRegistry → BrainRunner → BrainBuildContext → Brain.buildGraph()
    - filteredAllTools pattern: nativeTools + mcpTools → filter by ctx.enabledTools → bindTools + ToolNode
key_files:
  created:
    - packages/core/src/__tests__/unit/registry/registry-env-whitelist.test.ts
  modified:
    - packages/core/src/brain/interface.ts
    - packages/core/src/tools/registry.ts
    - packages/core/src/runner/runner.ts
    - apps/brain-sdr/src/brain.ts
decisions:
  - "D-01: enabledTools: Set<string> | null adicionado a BrainBuildContext — null = sem filtro, Set = whitelist ativa"
  - "D-02: getEnvWhitelist() expõe envWhitelist privado do ToolsRegistry sem quebrar encapsulamento do registry por brainType"
  - "D-03: filteredAllTools agrupa nativas + mcpTools antes de filtrar — uma única passagem, LLM e ToolNode sincronizados"
  - "D-04: respondTool incluída na lista filtrada (filteredAllTools exclui respondTool do ToolNode separadamente via nó respond)"
  - "D-05: Test 4 (ctx.enabledTools = getEnvWhitelist()) coberto indiretamente pelos integration tests do BrainRunner existentes"
metrics:
  duration: "~15 min"
  completed: "2026-06-30"
  tasks_completed: 2
  files_changed: 5
requirements:
  - TECH-01
---

# Phase 27 Plan 01: BRAIN_TOOLS Whitelist para Closures Nativas Summary

**One-liner:** Fluxo enabledTools de ToolsRegistry → BrainRunner → BrainBuildContext → brain-sdr.buildGraph() corrige TD-03 tornando BRAIN_TOOLS efetivo para tools bound como closures.

## What Was Built

TECH-01 resolve TD-03: o ENV `BRAIN_TOOLS` filtrava apenas `IBrain.tools[]` (stubs de schema via ToolsRegistry), mas não as tools criadas como closures diretamente em `buildGraph()` — tornando o controle de tools inerte para as tools reais do brain-sdr em produção.

A correção flui em três camadas:

1. **`BrainBuildContext.enabledTools`** — novo campo `Set<string> | null` na interface do SDK. `null` = sem filtro (BRAIN_TOOLS ausente ou vazio); `Set<string>` = whitelist ativa com nomes exatos.

2. **`ToolsRegistry.getEnvWhitelist()`** — getter público que expõe o `envWhitelist` privado (já parseado no construtor) para injeção no ctx pelo BrainRunner.

3. **`BrainRunner._compileGraph()` → `ctx.enabledTools`** — injeta `this.toolsRegistry.getEnvWhitelist()` no ctx antes de chamar `buildGraph()`, completando o fluxo.

4. **`brain-sdr.buildGraph()` → `filteredAllTools`** — agrupa `nativeTools` + `ctx.mcpTools` em `allTools`, filtra pelo `ctx.enabledTools` whitelist, e passa `filteredAllTools` tanto para `bindTools()` quanto para o `ToolNode`. LLM e executor permanecem sincronizados.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Expor enabledTools no BrainBuildContext e ToolsRegistry, injetar no runner | 7b037b0 | interface.ts, registry.ts, runner.ts, registry-env-whitelist.test.ts |
| 2 | Aplicar filtro enabledTools no brain-sdr buildGraph() | 2ffb2e7 | brain-sdr/src/brain.ts |

## Deviations from Plan

None — plano executado exatamente conforme descrito.

## Test Coverage

4 testes unitários criados em `packages/core/src/__tests__/unit/registry/registry-env-whitelist.test.ts`:
- Test 1: BRAIN_TOOLS não setado → `getEnvWhitelist()` retorna `null`
- Test 2: BRAIN_TOOLS="qualify_lead,search_knowledge" → retorna `Set{"qualify_lead","search_knowledge"}`
- Test 3: BRAIN_TOOLS="" → retorna `null` (WR-02: string vazia = não setado)
- Test 4 (adicional): BRAIN_TOOLS com espaços → nomes normalizados via trim

Test 4 do plano (ctx.enabledTools = getEnvWhitelist() no BrainRunner) coberto indiretamente pelos integration tests existentes do BrainRunner.

**Resultado:** 4/4 pass, 0 fail.

## Pattern de Referência para Novos Brains

```typescript
// Em buildGraph(ctx: BrainBuildContext):
const nativeTools = [tool1, tool2, tool3];
const allTools = [...nativeTools, ...ctx.mcpTools];
const filteredAllTools = ctx.enabledTools
  ? allTools.filter((t) => ctx.enabledTools!.has(t.name))
  : allTools;

const llmWithTools = ctx.llm.bindTools(filteredAllTools);
// ...
new ToolNode(filteredAllTools, { handleToolErrors: true })
```

## Known Stubs

None.

## Threat Flags

None — os controles T-27-01-01 (parsing seguro de BRAIN_TOOLS) e T-27-01-02 (filteredAllTools sincronizado com ToolNode) já estavam implementados no plano e foram entregues conforme especificado.

## Self-Check: PASSED

- [x] `packages/core/src/brain/interface.ts` — modificado, `enabledTools: Set<string> | null` presente
- [x] `packages/core/src/tools/registry.ts` — modificado, `getEnvWhitelist()` público presente
- [x] `packages/core/src/runner/runner.ts` — modificado, `enabledTools: this.toolsRegistry.getEnvWhitelist()` no ctx
- [x] `apps/brain-sdr/src/brain.ts` — modificado, `filteredAllTools` em `bindTools` e `ToolNode`
- [x] `packages/core/src/__tests__/unit/registry/registry-env-whitelist.test.ts` — criado, 4/4 testes passando
- [x] Commit 7b037b0 existe (Task 1)
- [x] Commit 2ffb2e7 existe (Task 2)
