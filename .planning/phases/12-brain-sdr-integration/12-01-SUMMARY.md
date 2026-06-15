---
phase: 12-brain-sdr-integration
plan: "01"
subsystem: agent
tags: [langgraph, brain-sdr, tool-contracts, brain-output, standard-tools]

# Dependency graph
requires:
  - phase: 11-tool-contracts-sdk
    provides: createPauseSessionTool, createFinishConversationTool factories em @brain-pkg/core
  - phase: 10-output-parser-sdk
    provides: BrainStateAnnotation com brainOutput field, BrainOutput type
provides:
  - brain-sdr migrado para contrato v1.2 completo com 3 tools bound no ToolNode + brainOutput no nó llm
  - pause_session e finish_conversation registrados no ToolsRegistry via enableTool()
  - lint script adicionado ao package.json do brain-sdr (INFRA-02 resolvido)
affects: [brain-sdr, 12-brain-sdr-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standard tools bound diretamente em buildGraph() via ctx.sql! — não passam por sdrBrain.tools[] (D-05)"
    - "brainOutput setado no nó llm sem spread de messages — brain ReAct usa append reducer"
    - "enableTool() chamado no index.ts para cada tool registrada no ToolsRegistry"

key-files:
  created: []
  modified:
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-sdr/src/brain.ts
    - apps/brain-sdr/src/index.ts
    - apps/brain-sdr/package.json

key-decisions:
  - "Standard tools (pause_session, finish_conversation) são bound em buildGraph() via ctx.sql! mas NÃO entram em sdrBrain.tools[] — campo estático permanece com apenas qualifyLeadTool (D-05)"
  - "ctx.sql! non-null assertion é segura: index.ts sempre passa sql no construtor do BrainRunner (linha 67)"
  - "messages: [response] sem spread no retorno do nó llm — brain-sdr usa ReAct com append reducer, diferente do brain-echo que usa spread"

patterns-established:
  - "Pattern D-05: tools[] estático do IBrain lista apenas tools para BrainRunner/ToolsRegistry; standard tools são bound diretamente em buildGraph() sem passar por tools[]"
  - "Pattern D-09: nó llm retorna {messages: [response], brainOutput: {fullResponse, responseMode}} — mesmo padrão do brain-echo exceto pelo spread"

requirements-completed: [PARSER-03, TOOLS-STD-03]

# Metrics
duration: 40min
completed: 2026-06-15
---

# Phase 12 Plan 01: Brain SDR Integration Summary

**Brain SDR migrado para contrato v1.2 completo: 3 tools bound no ToolNode LangGraph (qualify_lead + pause_session + finish_conversation) e nó llm setando brainOutput com fullResponse e responseMode: text**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-06-15T19:00:00Z
- **Completed:** 2026-06-15T19:39:56Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- brain.ts migrado para contrato v1.2: importa `createPauseSessionTool` e `createFinishConversationTool` de `@brain-pkg/core`, faz bind das 3 tools no LLM e no ToolNode, e o nó llm passa a retornar `brainOutput: { fullResponse, responseMode: "text" }` (PARSER-03)
- index.ts atualizado com `toolsRegistry.enableTool("sdr", "pause_session")` e `toolsRegistry.enableTool("sdr", "finish_conversation")` após o enableTool de qualify_lead (TOOLS-STD-03 + D-06)
- package.json com script `"lint": "tsc --noEmit"` adicionado (INFRA-02 resolvido)
- 12 testes unitários passando (9 existentes + 3 novos), TDD RED→GREEN completo

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: Atualizar brain.test.ts — mock corrigido + testes de 3 tools (RED)** — `ee5246a` (test)
2. **Task 2: Migrar brain.ts — 3 tools bound + brainOutput no nó llm (GREEN)** — `442b2d3` (feat)
3. **Task 3: Atualizar index.ts + package.json — enableTool standard tools e lint script** — `a2e8c53` (feat)

_Nota: Tasks 1-2 seguem o ciclo TDD (test RED → implementação GREEN). Task 3 sem TDD (verificação por grep/JSON parse)._

## Files Created/Modified

- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` — Adicionado `sql: {} as any` ao ctx existente; novos describes para Standard Tools binding (3 tools) e regressão de promptKeys
- `apps/brain-sdr/src/brain.ts` — Import de `createPauseSessionTool` e `createFinishConversationTool`; bound das 3 tools no llm e ToolNode; nó llm setando brainOutput
- `apps/brain-sdr/src/index.ts` — Registro de `pause_session` e `finish_conversation` no ToolsRegistry via enableTool()
- `apps/brain-sdr/package.json` — Script `"lint": "tsc --noEmit"` adicionado

## Decisions Made

- **Standard tools não entram em sdrBrain.tools[]:** O campo `tools` do IBrain é estático e serve ao BrainRunner/ToolsRegistry para descoberta. Standard tools são bound diretamente em `buildGraph()` via `ctx.sql!` — isso é intencional (D-05). Não é um esquecimento.
- **ctx.sql! non-null assertion:** Segura porque `index.ts` sempre passa `sql` no construtor do BrainRunner (`new BrainRunner({ brain: sdrBrain, sql, toolsRegistry })`). A assertiva evita `if (!ctx.sql)` redundante em buildGraph.
- **messages: [response] sem spread:** brain-sdr usa grafo ReAct com reducer de append no histórico; usar `[...state.messages, response]` causaria duplicação. Brain-echo usa spread porque acumula todo o histórico no retorno do nó (grafo simples sem ToolNode).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Instalação de dependências no worktree**
- **Found during:** Task 1 (execução dos testes RED)
- **Issue:** O worktree git não tinha `node_modules/` — `bun test` falhava com `Cannot find module '@langchain/core/tools'`
- **Fix:** Executado `bun install` no worktree para instalar dependências; compilados os packages internos com `turbo run build --filter='./packages/*'` para o typecheck
- **Files modified:** Nenhum arquivo de código — apenas instalação de dependências
- **Verification:** Testes passaram após instalação; typecheck retornou sem erros após build dos packages
- **Committed in:** Não commitado (node_modules está em .gitignore)

---

**Total deviations:** 1 auto-fixed (1 blocking — ambiente de worktree sem deps)
**Impact on plan:** Auto-fix necessário para completar a execução. Sem impacto de escopo.

## Issues Encountered

- Worktree git criado sem `node_modules/` — resolvido com `bun install` e `turbo run build --filter='./packages/*'` para gerar os arquivos `dist/` dos packages internos necessários ao TypeScript

## User Setup Required

Nenhum — nenhuma configuração de serviço externo necessária.

## Next Phase Readiness

- Brain SDR está no contrato v1.2 completo: brainOutput setado, 3 tools bound, ToolsRegistry atualizado
- Próximo passo: verificação end-to-end (`/gsd-verify-work`) para confirmar que `turbo run build` e `turbo run lint` passam em todos os pacotes
- Sem bloqueadores conhecidos

## Self-Check: PASSED

- FOUND: apps/brain-sdr/src/__tests__/unit/brain.test.ts
- FOUND: apps/brain-sdr/src/brain.ts
- FOUND: apps/brain-sdr/src/index.ts
- FOUND: apps/brain-sdr/package.json
- FOUND: .planning/phases/12-brain-sdr-integration/12-01-SUMMARY.md
- Commits ee5246a, 442b2d3, a2e8c53 verificados
- Todos os 8 critérios de aceitação do plano verificados (createPauseSessionTool, createFinishConversationTool, brainOutput, ToolNode 3 tools, tools[] D-05, enableTool pause_session, enableTool finish_conversation, lint script)
- 12 testes passando (0 falhas)

---
*Phase: 12-brain-sdr-integration*
*Completed: 2026-06-15*
