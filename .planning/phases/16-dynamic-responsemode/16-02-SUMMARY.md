---
phase: 16-dynamic-responsemode
plan: "02"
subsystem: apps/brain-sdr, apps/brain-echo, docs/guides
tags: [routeAfterLlm, respond-node, schema-as-tool, responseMode, tdd, pitfall-4, pitfall-6]
dependency_graph:
  requires:
    - 16-01 (createRespondTool factory, ResponseMode "undefined")
  provides:
    - brain-sdr com routeAfterLlm + nó respond + createRespondTool no bindTools (RESP-01, RESP-02, RESP-03)
    - brain-echo com routeAfterLlm + guarda hasMcpTools + nó respond (T-16-10)
    - docs/guides/response-format-prompt.md recriado com abordagem schema-as-tool (D-12)
  affects:
    - apps/brain-sdr/src/brain.ts (grafo atualizado)
    - apps/brain-echo/src/brain.ts (grafo atualizado)
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts (testes atualizados + novos)
    - apps/brain-echo/src/__tests__/unit/brain.test.ts (testes atualizados + novos)
    - apps/brain-echo/package.json (@langchain/core como devDependency)
    - docs/guides/response-format-prompt.md (recriado)
tech_stack:
  added: []
  patterns:
    - Router customizado routeAfterLlm — substitui toolsCondition prebuilt (3 destinos)
    - Nó respond como nó regular (não ToolNode) — seta brainOutput + emite ToolMessage (D-02)
    - Fallback D-10 no nó llm — responseMode "undefined" quando LLM não invoca respond tool
    - Guarda hasMcpTools via closure — evita ToolNode vazio em brain-echo (T-16-10)
    - TDD: RED (testes atualizados falhando) → GREEN (implementação passando)
key_files:
  created: []
  modified:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-echo/src/brain.ts
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-echo/src/__tests__/unit/brain.test.ts
    - apps/brain-echo/package.json
    - docs/guides/response-format-prompt.md
decisions:
  - "routeAfterLlm definida DENTRO de buildGraph() para ter acesso ao tipo BrainState sem importação adicional — brain-sdr usa tipo nativo BrainStateAnnotation.State; brain-echo usa any"
  - "nó respond é nó regular (não ToolNode) — Opção A do RESEARCH.md; permite setar brainOutput + emitir ToolMessage em um único retorno"
  - "brain-echo toolsForToolNode exclui respondTool — ToolNode de tools contém apenas MCP tools; respondTool no bindTools garante que LLM conhece o schema"
  - "@langchain/core adicionado como devDependency em brain-echo — testes que compilam e invocam o grafo precisam de instâncias reais de AIMessage (messagesStateReducer exige lc_kwargs)"
metrics:
  duration: "~11 minutos"
  completed: "2026-06-16"
  tasks_completed: 2
  files_created: 0
  files_modified: 6
---

# Phase 16 Plan 02: brain-sdr + brain-echo routeAfterLlm + nó respond Summary

**One-liner:** Router customizado `routeAfterLlm` (3 destinos) + nó `respond` adicionados a brain-sdr e brain-echo, fechando o ciclo do padrão schema-as-tool com `responseMode` dinâmico via `createRespondTool()`.

## What Was Built

### Task 1: brain-sdr — routeAfterLlm + nó respond + testes (TDD)

**brain-sdr/src/brain.ts:**

- `toolsCondition` removido das importações; substituído por `routeAfterLlm` definida dentro de `buildGraph()`
- `createRespondTool` adicionado ao import de `@brain-pkg/core`; `AIMessage`, `ToolMessage` importados de `@langchain/core/messages`; `END` importado de `@langchain/langgraph`
- `respondTool = createRespondTool()` adicionado ao `bindTools()` — bindTools agora recebe 4 tools nativas (qualify_lead + pause_session + finish_conversation + respond) + mcpTools
- Nó `llm` atualizado: detecta ausência de `respond` tool_call → fallback D-10 com `responseMode: "undefined" as const` + `logger.warn` com tag "PITFALL-6"
- Nó `respond` adicionado como nó regular: percorre messages em busca do tool_call respond, mapeia `mediaType: "file"` → `"document"` (D-05), seta `brainOutput`, emite `ToolMessage` (paridade AIMessage/ToolMessage — PITFALL-4)
- `.addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])` substituiu `toolsCondition`
- `.addEdge("respond", "__end__")` adicionado

**brain-sdr/__tests__/unit/brain.test.ts:**

- Test A atualizado: `responseMode` no fallback D-10 é `"undefined"` (era `"text"`)
- Test B atualizado: `bindTools` count = 4 (era 3) + `toContain("respond")`
- Test F atualizado: `bindTools` count com 1 MCP tool = 5 (era 4)
- Novos testes adicionados em `describe("BrainSDR — routeAfterLlm router customizado")`:
  - LLM com respond tool_call → `brainOutput.responseMode === "text"` e `fullResponse === "oi"`
  - LLM sem tool_calls → `brainOutput.responseMode === "undefined"` (fallback D-10)

**Resultado:** 16 testes passando (14 existentes atualizados + 2 novos)

### Task 2: brain-echo + docs (D-12)

**brain-echo/src/brain.ts:**

- Mesmas mudanças de importação que brain-sdr (`AIMessage`, `ToolMessage`, `END`, `ToolNode` sem `toolsCondition`)
- `createRespondTool` importado de `@brain-pkg/core`
- `allTools = [respondTool, ...ctx.mcpTools]` — bindTools com 1 tool quando mcpTools=[]
- `hasMcpTools` capturado via closure — guarda para T-16-10 (ToolNode vazio)
- `routeAfterLlm` com guarda `!hasMcpTools` → retorna END para tool calls desconhecidas quando sem MCP
- `toolsForToolNode = [...ctx.mcpTools]` — exclui respondTool do ToolNode de tools
- Nó `respond` idêntico ao brain-sdr
- HIST-03: mantido `messages: [...state.messages, response]` específico do brain-echo
- `.addConditionalEdges("llm", routeAfterLlm, ["tools", "respond", "__end__"])`
- `.addEdge("respond", "__end__")`

**brain-echo/package.json:**

- `@langchain/core: "^1.1.48"` adicionado como devDependency — necessário para testes que criam instâncias reais de `AIMessage` (messagesStateReducer exige `lc_kwargs`)

**brain-echo/__tests__/unit/brain.test.ts:**

- Import de `AIMessage` de `@langchain/core/messages` adicionado (via devDependency)
- Novos describes adicionados:
  - `"BrainEcho — Fase 16: routeAfterLlm + nó respond"`: bindTools count=1, nó respond no grafo, respond tool → responseMode correto, fallback D-10
  - `"BrainEcho — routeAfterLlm guarda ToolNode vazio"`: tool desconhecida com mcpTools=[] → END sem erro (T-16-10)

**Resultado:** 15 testes passando (10 existentes + 5 novos)

**docs/guides/response-format-prompt.md (D-12 — recriado):**

- Conteúdo anterior (abordagem de instrução de prompt para JSON) substituído
- Nova documentação documenta a abordagem schema-as-tool com `createRespondTool()`
- Inclui: por que schema-as-tool, schema da tool, fluxo do grafo, fallback D-10, guia de uso em novo Brain, guarda `hasMcpTools`, valores de responseMode

## Commits

| Task | Hash | Description |
|------|------|-------------|
| Task 1 | b995f39 | feat(16-02): atualizar brain-sdr com routeAfterLlm + nó respond + createRespondTool |
| Task 2 | c6a79dd | feat(16-02): atualizar brain-echo com routeAfterLlm + nó respond + docs recriados (D-12) |

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| brain-sdr/brain.test.ts | 16 | PASS (14 atualizados + 2 novos) |
| brain-echo/brain.test.ts | 15 | PASS (10 existentes + 5 novos) |
| apps/ + packages/core/ total | 146 pass, 6 skip, 4 fail | 4 falhas são pre-existentes (SC-4 stress test PostgreSQL + BrainRunner integration — BD indisponível) |

## Decisions Made

1. **routeAfterLlm dentro de buildGraph():** definida como função local dentro de `buildGraph()` para ter acesso ao tipo `BrainStateAnnotation.State` (brain-sdr) ou `any` (brain-echo) sem importação adicional. Alternativa de função global com tipo genérico considerada mas rejeitada por clareza.

2. **Nó respond é nó regular (não ToolNode):** Opção A escolhida conforme RESEARCH.md — permite setar `brainOutput` + emitir `ToolMessage` em um único retorno. ToolNode padrão retorna apenas `{ messages: [ToolMessage] }`.

3. **brain-echo toolsForToolNode exclui respondTool:** `allTools` (para bindTools) inclui respondTool; `toolsForToolNode` (para ToolNode de tools) exclui respondTool — separação intencional para que o ToolNode de MCP tools nunca processe a respond tool.

4. **@langchain/core como devDependency em brain-echo:** testes que compilam e invocam o grafo (`compiled.invoke()`) passam pelo `messagesStateReducer` do LangGraph, que exige instâncias reais de `BaseMessage` com `lc_kwargs`. Objetos literais simples causam `TypeError: undefined is not an object (evaluating 'm.lc_kwargs.id = m.id')`.

## Pitfalls Mitigados

| Pitfall | Mitigação |
|---------|-----------|
| PITFALL-4 | Nó `respond` emite `ToolMessage` com `tool_call_id` correto — paridade AIMessage/ToolMessage no PostgresSaver |
| PITFALL-6 | Fallback D-10 no nó `llm`: detecta ausência de respond tool_call, seta `responseMode: "undefined"`, loga warn "PITFALL-6" |

## Decisões do Plano Implementadas

| Decisão | Status | Implementação |
|---------|--------|---------------|
| D-01: router customizado | IMPLEMENTADO | `routeAfterLlm` em ambos os brains |
| D-02: nó respond como nó regular | IMPLEMENTADO | `addNode("respond", async (state) => {...})` |
| D-05: mediaType "file" → "document" | IMPLEMENTADO | Mapeamento explícito no nó respond |
| D-10: fallback responseMode "undefined" | IMPLEMENTADO | Detecção no nó llm + warn PITFALL-6 |
| D-11: system prompt sem atualização | IMPLEMENTADO | Sem migration SQL necessária |
| D-12: docs recriados | IMPLEMENTADO | docs/guides/response-format-prompt.md |

## Threat Model — Mitigações Implementadas

| Threat ID | Status | Implementação |
|-----------|--------|---------------|
| T-16-07 | MITIGATED | Mapeamento explícito "file" → "document" no nó respond (D-05) |
| T-16-08 | MITIGATED | `logger.warn` com conteúdo + tag "PITFALL-6" em ambos os brains |
| T-16-10 | MITIGATED | Guarda `!hasMcpTools` em brain-echo — ToolNode nunca é atingido com array vazio |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] @langchain/core como devDependency em brain-echo**
- **Found during:** Task 2 — testes que invocam `compiled.invoke()` com instâncias de AIMessage
- **Issue:** brain-echo não tinha `@langchain/core` como dependência direta; testes novos que criam instâncias reais de `AIMessage` (necessário para `messagesStateReducer`) falhavam com `Cannot find module '@langchain/core/messages'`
- **Fix:** Adicionado `@langchain/core: "^1.1.48"` em `devDependencies` de `apps/brain-echo/package.json`
- **Files modified:** `apps/brain-echo/package.json`
- **Commit:** c6a79dd

## Known Stubs

None — brain-sdr e brain-echo estão completamente implementados com o padrão schema-as-tool. O fluxo end-to-end (LLM real invocando a respond tool) será validado em produção com os prompts de seed.

## Threat Flags

Nenhum novo surface de segurança introduzido — as mudanças são internas ao grafo LangGraph; nenhum novo endpoint HTTP, auth path ou schema de banco foi criado.

## Self-Check: PASSED

- [x] `apps/brain-sdr/src/brain.ts` existe e contém `routeAfterLlm` (4 ocorrências)
- [x] `apps/brain-echo/src/brain.ts` existe e contém `routeAfterLlm` (5 ocorrências) e `hasMcpTools` (5 ocorrências)
- [x] `docs/guides/response-format-prompt.md` existe e contém "schema-as-tool" (4 ocorrências)
- [x] Commits b995f39 e c6a79dd existem
- [x] `bun test apps/brain-sdr/src/__tests__/unit/brain.test.ts` → 16 pass
- [x] `bun test apps/brain-echo/src/__tests__/unit/brain.test.ts` → 15 pass
- [x] `grep -rn "responseMode.*text.*as const" apps/` → 0 linhas
- [x] `grep -rn "toolsCondition" apps/brain-sdr/src/brain.ts apps/brain-echo/src/brain.ts` → apenas comentários, 0 importações/chamadas
- [x] 4 falhas da suite completa são pré-existentes (BD indisponível) — confirmado em 16-01-SUMMARY.md
