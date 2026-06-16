---
phase: 15-mcp-integration
plan: "02"
subsystem: apps/brain-sdr, apps/brain-echo, core/tests
tags: [mcp, brain-sdr, brain-echo, react, tool-node, integration-test]
dependency_graph:
  requires:
    - 15-01 (BrainBuildContext.mcpTools, BrainRunner MCP lifecycle)
  provides:
    - brain-sdr com mcpTools integrados em bindTools() e ToolNode
    - brain-echo refatorado para ReAct com suporte a mcpTools
    - .env.example de ambos os apps documentados com variáveis MCP
    - Teste de integração real contra servidor MCP externo
  affects:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-echo/src/brain.ts
    - apps/brain-sdr/.env.example
    - apps/brain-echo/.env.example
    - packages/core/src/__tests__/integration/mcp-connection.test.ts
tech_stack:
  added: []
  patterns:
    - ctx.mcpTools spread em bindTools() e ToolNode (D-03, MCP-02)
    - ToolNode com handleToolErrors:true em ambos os Brains (D-11, MCP-04)
    - brain-echo migrado de ctx.llm.invoke() direto para ReAct com llmWithTools.invoke()
    - allTools = [...ctx.mcpTools] como padrão de acesso às MCP tools em brain-echo
key_files:
  created:
    - packages/core/src/__tests__/integration/mcp-connection.test.ts
  modified:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-echo/src/brain.ts
    - apps/brain-echo/src/__tests__/unit/brain.test.ts
    - apps/brain-sdr/.env.example
    - apps/brain-echo/.env.example
decisions:
  - "brain-echo mantém messages: [...state.messages, response] (spread explícito) — diferente do brain-sdr que usa messages: [response] com reducer do ReAct; preserva compatibilidade com v1.2"
  - "allTools = [] com bindTools([]) é seguro — LLM sem tools nunca emite tool_calls → toolsCondition sempre vai para __end__"
  - "ToolNode([], { handleToolErrors: true }) com array vazio não lança — verificado em mcp-tool-error.test.ts (15-01)"
metrics:
  duration: "~15 minutos"
  completed_date: "2026-06-16"
  tasks_completed: 4
  files_created: 1
  files_modified: 6
  tests_added: 5
  tests_passing: 59
---

# Phase 15 Plan 02: Brain MCP Integration Summary

**One-liner:** brain-sdr e brain-echo recebem ctx.mcpTools via spread em bindTools()+ToolNode com handleToolErrors:true; brain-echo refatorado de invoke() direto para padrão ReAct completo.

## What Was Built

### Task 1: Atualizar brain-sdr — espalhar ctx.mcpTools com handleToolErrors

**`apps/brain-sdr/src/brain.ts`** — dois pontos modificados:

1. `bindTools()`: adicionado `...ctx.mcpTools` após as 3 tools nativas (qualify_lead, pause_session, finish_conversation). Quando `MCP_URL` ausente, `ctx.mcpTools = []` (D-02) e o comportamento é idêntico ao v1.2.

2. `ToolNode()`: adicionado `...ctx.mcpTools` no array de tools e habilitado `{ handleToolErrors: true }` (D-11, MCP-04) — erros de MCP tools viram `ToolMessage` controlado, sem corromper o thread (PITFALL-2 mitigado).

**`apps/brain-sdr/src/__tests__/unit/brain.test.ts`** — atualizado e expandido:
- `mcpTools: []` adicionado a todos os ctx mocks existentes (3 testes)
- Novo teste `"BrainSDR — MCP tools integration (MCP-02, D-03)"` verifica que `bindTools()` recebe 4 tools quando `ctx.mcpTools` tem 1 item

### Task 2: Refatorar brain-echo para ReAct com suporte a ctx.mcpTools

**`apps/brain-echo/src/brain.ts`** — refatoração completa:
- Antes: `ctx.llm.invoke()` chamado diretamente — sem tools, sem grafo ReAct
- Depois: padrão ReAct completo com `bindTools()`, `ToolNode`, `toolsCondition`
- `allTools = [...ctx.mcpTools]` — brain-echo não tem tools nativas, apenas MCP tools
- `ToolNode(allTools, { handleToolErrors: true })` — robusto mesmo com array vazio
- Guard `if (!ctx.llm.bindTools)` — mensagem clara se provider não suporta tool calling
- Mantido: `messages: [...state.messages, response]` — padrão brain-echo preserva compatibilidade com v1.2

**`apps/brain-echo/src/__tests__/unit/brain.test.ts`** — atualizado:
- `ctx.llm` agora expõe `bindTools` (mock) ao invés de `invoke` direto
- `mcpTools: []` adicionado ao ctx mock em todos os testes relevantes

### Task 3: Documentar variáveis MCP nos .env.example

Seção `"--- MCP Integration (opcional) ---"` adicionada ao final de:
- `apps/brain-sdr/.env.example` (após seção RabbitMQ)
- `apps/brain-echo/.env.example` (após seção Observability)

Todas as linhas comentadas (`#`). URL de exemplo real: `https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05`.

### Task 4: Criar teste de integração real contra servidor MCP de teste

**`packages/core/src/__tests__/integration/mcp-connection.test.ts`** — 4 testes:
1. `"conecta ao servidor MCP e retorna lista de tools"` — verifica Array e loga nomes
2. `"tools retornadas têm name e description"` — valida shape de cada tool
3. `"MCP_TOOLS CSV filtra tools por nome exato (MCP-01)"` — simula filtro manual
4. `"close() encerra conexão sem hang"` — verifica MCP-05 com timeout de 5s

Todos os testes fazem skip gracioso (try/catch + return) se servidor inacessível — não bloqueiam CI.

## Test Results

```
bun test apps/brain-sdr/src/__tests__/unit/
 28 pass · 0 fail · 60 expect() calls
Ran 28 tests across 3 files.

bun test apps/brain-echo/src/__tests__/unit/
 10 pass · 0 fail · 21 expect() calls
Ran 10 tests across 1 file.

bun test packages/core/src/__tests__/unit/
 21 pass · 0 fail · 37 expect() calls
Ran 21 tests across 3 files.

MCP_TEST_URL=https://webhook.biellil.com.br/mcp/01c8bedd-b8c8-4b40-8d95-e37c203cdd05 \
  bun test packages/core/src/__tests__/integration/mcp-connection.test.ts
MCP tools disponíveis (1): [ "getAvailableDate" ]
 4 pass · 0 fail · 7 expect() calls
Ran 4 tests across 1 file.
```

Servidor MCP acessível — retornou 1 tool: `getAvailableDate`.

## Deviations from Plan

None — plano executado exatamente como escrito.

A única adaptação foi no teste `"nó do grafo invoca LLM com slice das mensagens quando CONTEXT_WINDOW_MESSAGES=2"` do brain-echo: o ctx mock foi atualizado para usar `bindTools` ao invés de `invoke` diretamente, pois a refatoração ReAct passou a exigir `ctx.llm.bindTools`. Isso não é um desvio — é a atualização de teste consequente à refatoração (parte do TDD).

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| brain-echo mantém `messages: [...state.messages, response]` | Preserva comportamento v1.2 — brain-sdr usa `[response]` com reducer; brain-echo acumula explicitamente para compatibilidade |
| `bindTools([])` com array vazio é seguro | LLM sem tools nunca emite `tool_calls` → `toolsCondition` sempre roteia para `__end__`; sem impacto de performance |
| Guard `if (!ctx.llm.bindTools)` em brain-echo | Mensagem de erro clara para operadores que configuram provider sem tool calling; segue mesmo padrão do brain-sdr |

## Threat Flags

Nenhum. Ameaças do threat model (T-15-06, T-15-07, T-15-08) tratadas conforme especificado:
- T-15-06: `handleToolErrors: true` em ambos os Brains — output de MCP tool vira ToolMessage controlado
- T-15-07: MCP tools no mesmo ToolNode das nativas — design intencional, aceito
- T-15-08: MCP tool que trava — LangGraph tem limite de steps; responsabilidade do operador configurar MCP server confiável

## Commits

| Hash | Description |
|------|-------------|
| `2b13a91` | feat(15-02): spread ctx.mcpTools em brain-sdr com handleToolErrors |
| `23000f3` | feat(15-02): refatorar brain-echo para ReAct com suporte a ctx.mcpTools |
| `171030c` | docs(15-02): documentar variáveis MCP nos .env.example de brain-sdr e brain-echo |
| `ff54edc` | test(15-02): criar teste de integração real contra servidor MCP de teste |

## Self-Check: PASSED
