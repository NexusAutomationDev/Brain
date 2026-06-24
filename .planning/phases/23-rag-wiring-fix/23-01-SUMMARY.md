---
phase: 23-rag-wiring-fix
plan: "01"
subsystem: brain-sdr
tags: [rag, tool-binding, langgraph, search-knowledge, wiring]
dependency_graph:
  requires: [packages/core/src/tools/search-knowledge.ts]
  provides: [search_knowledge tool wired into brain-sdr LLM and ToolNode]
  affects: [apps/brain-sdr/src/brain.ts, apps/brain-sdr/src/__tests__/unit/brain.test.ts]
tech_stack:
  added: []
  patterns: [factory-with-closure, schema-as-tool static declaration, TDD green]
key_files:
  created: []
  modified:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
decisions:
  - "D-01 (Phase 23): boundSearchKnowledgeTool instanciada com createSearchKnowledgeTool(ctx.sql!) — mesmo padrão de boundPauseSessionTool"
  - "D-02 (Phase 23): searchKnowledgeToolSchema adicionada a sdrBrain.tools[] como schema estático declarativo — mantém contrato IBrain completo"
  - "D-03 (Phase 23): sdrBrain.tools[] agora tem 2 entries: qualifyLeadTool + searchKnowledgeToolSchema"
metrics:
  duration: "~3 minutos"
  completed: "2026-06-24T22:09:56Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 23 Plan 01: RAG Wiring Fix — search_knowledge vinculada ao LLM e ToolNode

**One-liner:** `createSearchKnowledgeTool(ctx.sql!)` wired into `bindTools()` and `ToolNode` in brain-sdr, closing RAG-02 and RAG-03 end-to-end.

## What Was Done

### Task 1: Adicionar createSearchKnowledgeTool ao buildGraph() de brain-sdr

**Arquivo:** `apps/brain-sdr/src/brain.ts`

Quatro mudanças cirúrgicas e aditivas:

1. **Import** — `createSearchKnowledgeTool` adicionado ao import de `@brain-pkg/core` (linha 16)
2. **Schema estático** — `searchKnowledgeToolSchema` definido via `tool()` antes de `sdrBrain` (linhas 23-41); mesmo padrão de `qualifyLeadTool`. Usado apenas como campo declarativo do contrato `IBrain` — nunca executado em produção.
3. **sdrBrain.tools[]** — atualizado de `[qualifyLeadTool]` para `[qualifyLeadTool, searchKnowledgeToolSchema]` (linha 49)
4. **buildGraph() — instanciação** — `const boundSearchKnowledgeTool = createSearchKnowledgeTool(ctx.sql!)` adicionado após `boundFinishConversationTool` (linha 87)
5. **bindTools()** — `boundSearchKnowledgeTool` adicionado antes de `respondTool` no array de 5 tools nativas (linha 107)
6. **ToolNode** — `boundSearchKnowledgeTool` adicionado antes do spread `...ctx.mcpTools` (linha 213)

**Commit:** `96e1931`

### Task 2: Atualizar testes unitários

**Arquivo:** `apps/brain-sdr/src/__tests__/unit/brain.test.ts`

Quatro testes atualizados:

1. **`BrainSDR — IBrain contract`** — teste de `sdrBrain.tools` atualizado: `toHaveLength(2)` + `toContain("qualify_lead")` + `toContain("search_knowledge")`
2. **`BrainSDR — Standard Tools binding`** — `bindTools` agora afirma `toHaveLength(5)` + `toContain("search_knowledge")`
3. **`sdrBrain.tools[] estático`** — atualizado de 1 para 2 tools com assertion por nome
4. **`BrainSDR — MCP tools integration`** — `bindTools` com 1 MCP tool agora afirma `toHaveLength(6)` + `toContain("search_knowledge")`

**Resultado:** 17/17 testes passando — 0 regressões

**Commit:** `0a86b57`

## Decisions Made

| Decision | Implementação | Arquivo/Linha |
|----------|--------------|---------------|
| D-01 (Phase 23): boundSearchKnowledgeTool com closure sobre ctx.sql | `createSearchKnowledgeTool(ctx.sql!)` em buildGraph() | brain.ts:87 |
| D-02 (Phase 23): schema estático em sdrBrain.tools[] | `searchKnowledgeToolSchema` via `tool()` | brain.ts:25-41 |
| D-03 (Phase 23): 2 entries em sdrBrain.tools[] | `[qualifyLeadTool, searchKnowledgeToolSchema]` | brain.ts:49 |

## Requirements Closed

| Requirement | Status | Evidence |
|-------------|--------|----------|
| RAG-02 | CLOSED | `boundSearchKnowledgeTool` em `bindTools()` — LLM pode chamar `search_knowledge` |
| RAG-03 | CLOSED | `search_knowledge` aceita `collections[]` — implementado em `searchKnowledge()` do core |

## Test Results

```
17 pass
 0 fail
41 expect() calls
Ran 17 tests across 1 file. [1071ms]
```

## Deviations from Plan

Nenhuma — plano executado exatamente como escrito. As modificações foram estritamente aditivas.

## Known Stubs

Nenhum. `searchKnowledgeToolSchema` é um schema estático declarativo por design (campo `IBrain.tools[]` documenta tools disponíveis para o BrainRunner/ToolsRegistry). A versão executável é `boundSearchKnowledgeTool = createSearchKnowledgeTool(ctx.sql!)`, que é a que vai ao LLM e ao ToolNode.

## Threat Flags

Nenhum novo trust boundary introduzido neste plano. Os limites `LLM → search_knowledge` e `search_knowledge → pgvector` já estavam documentados no threat model do plano e são mitigados pela validação Zod (`z.array(z.string().min(1)).min(1)`) que já existe em `createSearchKnowledgeTool`.

## Self-Check: PASSED

- [x] `apps/brain-sdr/src/brain.ts` existe e contém `createSearchKnowledgeTool` no import
- [x] `apps/brain-sdr/src/__tests__/unit/brain.test.ts` existe e contém `toHaveLength(5)` para bindTools
- [x] Commit `96e1931` existe (feat: wire createSearchKnowledgeTool)
- [x] Commit `0a86b57` existe (test: update unit tests)
- [x] 17/17 testes passando
