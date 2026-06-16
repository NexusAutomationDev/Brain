---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: MCP Integration + Dynamic responseMode
status: planning
stopped_at: Phase 17 context gathered
last_updated: "2026-06-16T00:59:56.788Z"
last_activity: 2026-06-16
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-15 — milestone v1.3 started)

**Core value:** Infraestrutura de agentes modular onde novos Brains são criados definindo apenas prompts, tools, embeddings e fluxos — sem reescrever a base

**Current focus:** Milestone v1.3 — Phase 14: TD-01 Fix

## Current Position

Phase: 17 of 17 (expor contagem de tokens gastos na resposta da api rest e ra)
Plan: Not started
Status: Ready to plan
Last activity: 2026-06-16

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 1 (v1.3)
- Average duration: — (no plans yet)
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 14 | 1 | - | - |

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- Phase 17 added: Expor contagem de tokens gastos na resposta da API REST e RabbitMQ

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting v1.3:

- schema-as-tool para responseMode (Phase 16): `withStructuredOutput()` + `bindTools()` são mutuamente exclusivos (langchainjs #7757) — usar `createRespondTool()` vinculado via `bindTools()` + nó `respond` + router customizado
- MCP transport: `"streamable_http"` (underscore) sempre — hífen lança ValueError sem mensagem clara (mcp-adapters #322)
- MCP client lifecycle em `_compileGraph()`: inicializado uma vez por processo, não por request
- SSE fora de escopo: deprecated no spec MCP (março 2025) + bug Bun (EventSource not defined)

### Blockers/Concerns

- [Phase 15] PITFALL-1: MultiServerMCPClient descarta tools de todos os servers quando qualquer server falha — defensive catch obrigatório em getTools()
- [Phase 15] PITFALL-2: MCP tool timeout deixa AIMessage sem par ToolMessage → thread corrompido permanentemente — safe ToolNode wrapper obrigatório
- [Phase 16] PITFALL-6: LLM pode emitir texto plano em vez de chamar `respond` tool → BrainOutputValidationError — instrução forte no system prompt seed

### Tech Debt (carry-over de v1.2)

- **TD-01** (targeted Phase 14): `qualifier.ts` sem `prepare: false`
- **TD-03** (Baixo): `BRAIN_TOOLS` whitelist inerte para tools bound diretamente em `buildGraph()`
- **TD-04** (Baixo): `LeadService.setFullpp()` / `setIaAtivada()` sem callers de produção

## Session Continuity

Last session: 2026-06-16T00:59:56.781Z
Stopped at: Phase 17 context gathered
Resume: Run `/gsd-plan-phase 14`
