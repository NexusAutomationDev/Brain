---
phase: 09-brain-sdr
plan: "02"
subsystem: brain-sdr
tags: [tdd, react-graph, tool-calling, qualification-agent, langgraph, sdl-04]
dependency_graph:
  requires: [09-00, 09-01]
  provides: [brain-sdr-core, qualify-lead-tool, qualification-sub-agent]
  affects: [09-03]
tech_stack:
  added:
    - "@langchain/langgraph-checkpoint-postgres: ^1.0.1 (added to brain-sdr package.json)"
  patterns:
    - "ReAct 2-node graph: llm → toolsCondition → tools → llm → __end__"
    - "boundQualifyTool closure pattern — injects ctx.prompts[qualification] at runtime"
    - "stateless sub-agent compiled without checkpointer (StateGraph.compile() no args)"
    - "PostgresSaver.getTuple() without setup() — tables pre-exist from BrainRunner.init()"
    - "_getType() instead of instanceof for message type discrimination"
    - "extractJSON() to strip LLM code fences before JSON.parse"
    - "graceful fallback pattern on all async failure paths"
key_files:
  created:
    - apps/brain-sdr/src/brain.ts
    - apps/brain-sdr/src/qualifier.ts
  modified:
    - apps/brain-sdr/package.json
    - pnpm-lock.yaml
decisions:
  - "boundQualifyTool criado em buildGraph() como closure sobre ctx.prompts[qualification] — garante SDR-04 zero prompts hardcoded mesmo no sub-agente"
  - "qualifyLeadTool exportado de qualifier.ts serve apenas como contrato IBrain (schema/name/description); boundQualifyTool é quem executa em produção"
  - "Sub-agente de qualificação é stateless (compile sem checkpointer) — lê histórico via PostgresSaver.getTuple() mas não persiste estado próprio"
  - "Fallback gracioso em todos os pontos de falha do sub-agente — não derruba a conversa principal (Q2 do RESEARCH.md resolvido)"
  - "Dependência @langchain/langgraph-checkpoint-postgres adicionada ao brain-sdr package.json (ausente no scaffolding inicial)"
metrics:
  duration: "~45 min"
  completed: "2026-06-14T22:00:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 09 Plan 02: Brain SDR — brain.ts + qualifier.ts Summary

## One-liner

BrainSDR IBrain com grafo ReAct 2-nós (ToolNode + toolsCondition) e sub-agente de qualificação stateless que lê histórico via PostgresSaver.getTuple() e injeta o prompt do banco via closure em buildGraph() — SDR-04 honrado completamente.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implementar brain.ts — BrainSDR com grafo ReAct | 2330887 | apps/brain-sdr/src/brain.ts |
| 2 | Implementar qualifier.ts — tool qualify_lead + sub-agente stateless | a37f86b | apps/brain-sdr/src/qualifier.ts, apps/brain-sdr/package.json, pnpm-lock.yaml |

## What Was Built

**brain.ts** — `sdrBrain: IBrain` completo:
- `id: "brain-sdr"`, `brainType: "sdr"`, `promptKeys: ["system", "qualification"]`
- `tools: [qualifyLeadTool]` — campo estático IBrain para BrainRunner/ToolsRegistry
- `buildGraph(ctx)` retorna `StateGraph(BrainStateAnnotation)` NÃO compilado (anti-pattern evitado)
- `boundQualifyTool` criado como closure dentro de `buildGraph()` capturando `ctx.prompts["qualification"]` — garante que o prompt do banco é sempre usado (SDR-04)
- `ctx.llm.bindTools([boundQualifyTool])` e `new ToolNode([boundQualifyTool])` — nunca `ctx.tools` diretamente
- `toolsCondition` e `ToolNode` importados de `@langchain/langgraph/prebuilt` (Pitfall 7 do RESEARCH.md evitado)
- Context window `slice(-N)` no nó `llm` com ENV `CONTEXT_WINDOW_MESSAGES` (fallback 40, validação T-08-ENV)

**qualifier.ts** — `qualifyLeadTool` + `runQualificationAgent()`:
- `qualifyLeadTool.name === "qualify_lead"`, schema Zod `{description: string, session_id: string}`
- `runQualificationAgent(description, sessionId, qualificationPrompt?)` — terceiro parâmetro opcional
- `PostgresSaver.fromConnString(DATABASE_URL)` sem `.setup()` — tabelas já existem (Pitfall 4 evitado)
- `m._getType() === "ai"` / `"human"` em vez de `instanceof AIMessage` (anti-pattern evitado)
- Sub-agente `qualificationGraph.compile()` sem checkpointer — stateless por design (D-04)
- `extractJSON()` remove code fences antes de `JSON.parse` (Pitfall 5 do RESEARCH.md)
- Fallback gracioso em `getTuple()` undefined e `JSON.parse` falha — não derruba conversa principal

**Desvio de dependência (Rule 2):** `@langchain/langgraph-checkpoint-postgres` não estava no `package.json` do brain-sdr. Adicionado como dependência obrigatória para `qualifier.ts`.

## Test Results

```
bun test apps/brain-sdr/src/__tests__/unit
 9 pass
 0 fail
 16 expect() calls
Ran 9 tests across 1 file. [432ms]
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Dependency] @langchain/langgraph-checkpoint-postgres ausente no package.json**
- **Found during:** Task 2
- **Issue:** `qualifier.ts` importa `@langchain/langgraph-checkpoint-postgres` mas o pacote não estava listado em `apps/brain-sdr/package.json` (scaffolding do Plan 00 não o incluiu)
- **Fix:** Adicionado `"@langchain/langgraph-checkpoint-postgres": "^1.0.1"` nas dependencies + `pnpm install` para atualizar lockfile
- **Files modified:** `apps/brain-sdr/package.json`, `pnpm-lock.yaml`
- **Commit:** a37f86b

**2. [Rule 3 - Blocking] node_modules ausentes no worktree**
- **Found during:** Task 1 (primeiro run dos testes)
- **Issue:** Worktree não tinha `node_modules` instalados — bun não resolvia `@langchain/core/tools`
- **Fix:** `pnpm install --no-frozen-lockfile` (lockfile do transport package estava desatualizado com nova dependência `rabbitmq-client`)
- **Build:** `pnpm build` para compilar os packages `@brain-pkg/*` que não tinham `dist/` no worktree

**3. [Rule 1 - Bug] Comentários com .compile() em brain.ts interferiam com grep de verificação**
- **Found during:** Verificação pós-implementação
- **Issue:** Dois comentários contendo `.compile()` como documentação de anti-pattern causavam falso positivo no critério `grep -c ".compile(" → 0`
- **Fix:** Alterados comentários para `compile()` (sem ponto) — mantendo intenção de documentação sem `.compile(` literal

## Known Stubs

Nenhum. Todos os paths de execução retornam valores reais ou fallback explícito.

## Threat Flags

Nenhuma superfície nova além do que está documentado no threat model do plano. As mitigações T-09-02-01 a T-09-02-06 foram implementadas:
- T-09-02-01: Zod schema valida `description` e `session_id` antes de executar
- T-09-02-04: `extractJSON()` + try/catch + typeof checks nos campos parseados
- T-09-02-05: catch() no `runQualificationAgent` retorna fallback seguro
- T-09-02-06: `logger.info({ session_id })` no início do `boundQualifyTool`

## Self-Check: PASSED

| Item | Status |
|------|--------|
| FOUND: apps/brain-sdr/src/brain.ts | OK |
| FOUND: apps/brain-sdr/src/qualifier.ts | OK |
| FOUND: .planning/phases/09-brain-sdr/09-02-SUMMARY.md | OK |
| COMMIT: 2330887 (brain.ts) | OK |
| COMMIT: a37f86b (qualifier.ts) | OK |
| bun test: 9/9 GREEN | OK |
