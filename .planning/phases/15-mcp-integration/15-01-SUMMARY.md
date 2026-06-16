---
phase: 15-mcp-integration
plan: "01"
subsystem: core/mcp
tags: [mcp, langchain, brain-runner, mcp-adapters, lifecycle]
dependency_graph:
  requires: []
  provides:
    - BrainBuildContext.mcpTools (StructuredTool[])
    - BrainRunner.close()
    - BrainRunner MCP lifecycle (init, SIGTERM, _compileGraph MCP block)
  affects:
    - packages/core/src/brain/interface.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/__tests__/unit/mcp-init.test.ts
    - packages/core/src/__tests__/unit/mcp-tool-error.test.ts
tech_stack:
  added:
    - "@langchain/mcp-adapters@1.1.3"
  patterns:
    - MultiServerMCPClient com onConnectionError:"ignore"
    - Defensive catch em getTools() para startup resiliente
    - SIGTERM handler registrado no SDK (não no app)
    - mcpTools injetado via BrainBuildContext (D-01, D-02)
key_files:
  created:
    - packages/core/src/__tests__/unit/mcp-init.test.ts
    - packages/core/src/__tests__/unit/mcp-tool-error.test.ts
  modified:
    - packages/core/src/brain/interface.ts
    - packages/core/src/runner/runner.ts
    - packages/core/package.json
    - pnpm-lock.yaml
decisions:
  - "D-14 CORREÇÃO aplicada: sem 'streamable_http' no código JS — apenas 'url' é suficiente para identificar HTTP transport no @langchain/mcp-adapters JS"
  - "onConnectionError: 'ignore' — PITFALL-1 mitigado, Brain sobe normalmente mesmo com MCP server down"
  - "mcpTools injetado como [] quando MCP_URL ausente — nunca undefined (D-02)"
  - "MCP_AUTH_TOKEN nunca logado — T-15-01 mitigado"
  - "SIGTERM handler registrado no SDK após _compileGraph() — apps não precisam implementar"
metrics:
  duration: "~4 minutos"
  completed_date: "2026-06-16"
  tasks_completed: 2
  files_created: 2
  files_modified: 4
  tests_added: 12
  tests_passing: 30
---

# Phase 15 Plan 01: MCP Base Infrastructure Summary

**One-liner:** MCP lifecycle completo no BrainRunner com @langchain/mcp-adapters@1.1.3 — init resiliente, close() limpo e mcpTools injetado no BrainBuildContext.

## What Was Built

### Task 1: Instalar @langchain/mcp-adapters e criar testes Wave 0

Instalado `@langchain/mcp-adapters@1.1.3` em `packages/core`. Criados dois arquivos de teste unitário:

**`mcp-init.test.ts`** (10 testes):
- MCP_URL ausente → mcpTools = [], sem cliente criado
- MCP_URL definido + getTools() resolve → mcpTools com tools retornadas
- MCP server inacessível → mcpTools = [], warn logado, sem throw
- MCP_TOOLS CSV → filtra por nome exato
- MCP_TOOLS vazio → retorna todas as tools
- MCP_AUTH_TOKEN definido → header Authorization Bearer no config
- MCP_AUTH_TOKEN ausente → sem campo headers no config
- onConnectionError é "ignore" na config
- close() é no-op quando mcpClient é null
- close() chama mcpClient.close() e seta null

**`mcp-tool-error.test.ts`** (2 testes):
- ToolNode com handleToolErrors:true injeta ToolMessage de erro sem lançar (PITFALL-2)
- ToolNode com array vazio não lança em construção

### Task 2: Adicionar mcpTools ao BrainBuildContext e implementar MCP lifecycle

**`packages/core/src/brain/interface.ts`:**
- Campo `mcpTools: StructuredTool[]` adicionado ao `BrainBuildContext`
- JSDoc documenta que é sempre array (nunca undefined), [] quando MCP_URL ausente

**`packages/core/src/runner/runner.ts`:**
- Import: `MultiServerMCPClient` de `@langchain/mcp-adapters`
- Campo privado: `private mcpClient: MultiServerMCPClient | null = null`
- Método público `close()`: fecha mcpClient de forma limpa, no-op se null
- Handler SIGTERM em `init()`: registrado após `_compileGraph()`, chama `close()` + `process.exit(0)`
- Bloco MCP em `_compileGraph()`: inicializa MultiServerMCPClient, carrega tools, filtra via MCP_TOOLS CSV, defensive catch
- `ctx: BrainBuildContext` atualizado com `mcpTools`

## Test Results

```
bun test packages/core/src/__tests__/
 30 pass · 0 fail · 46 expect() calls
Ran 30 tests across 4 files.

bun test apps/brain-sdr/src/__tests__/
 27 pass · 3 skip · 0 fail
```

## Deviations from Plan

None — plano executado exatamente como escrito.

O campo `mcpTools` usa `import("@langchain/core/tools").StructuredTool[]` inline no runner.ts (não um import de topo) para evitar import circular potencial — funcional e aceito pelo TypeScript.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| D-14: sem "streamable_http" | Apenas `url` identifica HTTP transport no JS adapter — "streamable_http" é Python only |
| onConnectionError: "ignore" | PITFALL-1: default "throw" travaria startup se MCP server down |
| mcpTools sempre array | D-02: nunca undefined — Brains podem espalhar sem verificar undefined |
| T-15-01: MCP_AUTH_TOKEN não logado | Apenas `{ brainId, err }` no warn — token não entra em logs |
| SIGTERM no SDK | Apps (index.ts) não precisam implementar handlers de shutdown |

## Threat Flags

Nenhum. Todas as ameaças do threat model foram tratadas conforme especificado (T-15-01 a T-15-05).

## Commits

| Hash | Description |
|------|-------------|
| `b051b6a` | test(15-01): add MCP unit tests Wave 0 and install @langchain/mcp-adapters |
| `e0f2ea3` | feat(15-01): add mcpTools to BrainBuildContext and implement MCP lifecycle in BrainRunner |

## Self-Check: PASSED
