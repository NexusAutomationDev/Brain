---
phase: 10-output-parser-sdk
plan: "03"
subsystem: api
tags: [brain-echo, transport, duck-typing, brain-output, webhook, output-parser]

# Dependency graph
requires:
  - phase: 10-output-parser-sdk/10-01
    provides: BrainOutput interface em @brain-pkg/shared, BrainOutputSchema em packages/core
  - phase: 10-output-parser-sdk/10-02
    provides: BrainStateAnnotation com brainOutput, BrainRunner.run() retornando BrainOutput | null

provides:
  - brain-echo nó "llm" setando state.brainOutput com { fullResponse, responseMode: "text" }
  - IBrainRunnerLike em packages/transport com duck typing compatível com BrainOutput (sem import de @brain-pkg/core)
  - handler.ts extraindo result.fullResponse e retornando como campo reply na HTTP response
  - Todos os 4 critérios de success da Fase 10 satisfeitos

affects:
  - apps/brain-sdr (mesma migração necessária na Fase 12)
  - Fase 12 (brain-sdr migration para brainOutput)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Duck typing local em transport para evitar ciclo core→transport→core"
    - "Nó LangGraph monta BrainOutput manualmente (sem .withStructuredOutput()) — D-07, D-08"
    - "API pública do webhook mantém campo reply mesmo com mudança interna para fullResponse"

key-files:
  created: []
  modified:
    - apps/brain-echo/src/brain.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/webhook/handler.test.ts
    - packages/transport/src/__tests__/unit/webhook-auth.test.ts

key-decisions:
  - "IBrainRunnerLike em transport usa duck typing em vez de importar BrainOutput de @brain-pkg/core — evita ciclo de dependência core→transport→core"
  - "handler.ts mantém campo reply na resposta HTTP — clientes do webhook não percebem mudança interna para fullResponse"
  - "brain-echo monta fullResponse como typeof response.content === 'string' ? response.content : '' — aceita string vazia como risco documentado (text-only brain)"

patterns-established:
  - "Pattern SDK-06: nó LangGraph extrai content do LLM e monta BrainOutput inline sem .withStructuredOutput()"
  - "Pattern Duck-typing local: transport define interface local compatível com shape de BrainOutput sem import circular"

requirements-completed:
  - PARSER-02

# Metrics
duration: 20min
completed: "2026-06-15"
---

# Phase 10 Plan 03: brain-echo e transport migrados para BrainOutput — Fase 10 completa Summary

**brain-echo nó "llm" seta state.brainOutput com { fullResponse, responseMode: "text" } e transport atualizado para duck typing IBrainRunnerLike compatível com BrainOutput, fechando o ciclo da Fase 10**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-15T03:55:00Z
- **Completed:** 2026-06-15T04:15:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Nó "llm" do brain-echo agora retorna `{ messages, brainOutput: { fullResponse, responseMode: "text" } }` — BrainRunner.run() receberá e validará via BrainOutputSchema.parse()
- IBrainRunnerLike no transport usa duck typing estrutural com { fullResponse, responseMode, mediaType?, mediaUrl? } — sem import de @brain-pkg/core, ciclo de dependência prevenido
- handler.ts extrai result.fullResponse e o retorna como campo `reply` na HTTP response — API pública do webhook não sofre breaking change
- Todos os 9 checks do Phase Gate passam; 115 testes unitários verdes em core, ai, transport e brain-echo (2 falhas pré-existentes no integration test, não causadas por este plano)

## Task Commits

Cada task foi commitada atomicamente:

1. **Task 1: brain-echo nó "llm" seta state.brainOutput** - `ab115d7` (feat)
2. **Task 2: IBrainRunnerLike duck typing + handler.ts + webhook-auth fix** - `dc90b2a` (feat)

## Files Created/Modified

- `apps/brain-echo/src/brain.ts` — Nó "llm" extrai fullResponse do content do LLM e retorna brainOutput: { fullResponse, responseMode: "text" as const }
- `packages/transport/src/webhook/handler.ts` — IBrainRunnerLike atualizada com duck typing; reply usa result.fullResponse
- `packages/transport/src/webhook/handler.test.ts` — Mock atualizado para { fullResponse, responseMode } em vez de { reply }
- `packages/transport/src/__tests__/unit/webhook-auth.test.ts` — Mock atualizado para { fullResponse, responseMode } em vez de { reply } (Rule 1 auto-fix)

## Decisions Made

- **Duck typing local em transport:** IBrainRunnerLike definida localmente em handler.ts com shape de BrainOutput em vez de importar BrainOutput de @brain-pkg/core — evita ciclo de dependência core→transport→core (core já depende de transport para BrainEvent)
- **reply na HTTP response:** campo reply mantido na resposta HTTP do webhook mesmo com mudança interna para fullResponse — garante zero breaking change para clientes existentes
- **Sem fallback para string vazia em brain-echo:** fullResponse pode ser "" se LLM retornar content não-string (ex: tool_calls); BrainRunner vai lançar BrainOutputValidationError — comportamento fail-fast aceitável para brain text-only

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock de webhook-auth.test.ts também usava { reply } antigo**
- **Found during:** Task 2 (suite completa cruzada após mudanças no handler.ts)
- **Issue:** O arquivo `packages/transport/src/__tests__/unit/webhook-auth.test.ts` tinha mock `{ reply: "Olá! Como posso ajudar?" }` — com a nova IBrainRunnerLike TypeScript aceita em tempo de compilação mas em runtime result.reply é undefined, body.reply retorna undefined, teste falha
- **Fix:** Atualizado mock para `{ fullResponse: "Olá! Como posso ajudar?", responseMode: "text" }` — mesma mudança aplicada no handler.test.ts do plano
- **Files modified:** `packages/transport/src/__tests__/unit/webhook-auth.test.ts`
- **Verification:** `bun test packages/transport/src` — 8 testes passando antes, ainda 8 passando depois; suite cruzada 115 pass
- **Committed in:** dc90b2a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug em teste de transport não listado no plano)
**Impact on plan:** Correção necessária para que os testes existentes continuassem passando após a mudança na interface. Sem scope creep.

## Issues Encountered

- **Worktree sem node_modules:** Worktree não tinha node_modules — `pnpm install --no-frozen-lockfile` executado para resolver pacotes workspace. Mesmo padrão do Plano 02.
- **brain-runner.integration.test.ts pré-existente:** 2 falhas em `onConflictDoNothing is not a function` e `db.delete is not a function` — confirmadas como pré-existentes no 10-02-SUMMARY, não causadas por este plano.

## Known Stubs

Nenhum — todas as mudanças são implementação real. fullResponse extraído do LLM real em runtime (sem hardcoded), duck typing estrutural verificado em compile-time.

## Threat Flags

Nenhuma — sem novos endpoints de rede, paths de auth, ou mudanças de schema em trust boundaries. T-10-07, T-10-08 e T-10-09 do threat model do plano estão todos implementados:
- T-10-07: BrainRunner.run() valida brainOutput via BrainOutputSchema.parse() antes de retornar ao cliente
- T-10-08: Campo reply na resposta HTTP contém apenas fullResponse (texto do LLM) — sem vazamento de state interno
- T-10-09: Duck typing estrutural TypeScript garante em compile-time que qualquer instância passada satisfaz o contrato

## Phase Gate Results

Todos os 9 checks do Phase Gate passam:

1. `bun test packages/core/src/__tests__/unit/output` — 9 pass (BrainOutputSchema verde — PARSER-01)
2. `bun test packages/core/src/runner/__tests__/brain-runner.test.ts` — 17 pass (runner verde — PARSER-02)
3. `bun test apps/brain-echo/src/__tests__/unit` — 10 pass (brain-echo verde — PARSER-02 / Success Criteria 4)
4. `bun test packages/transport/src` — 8 pass (transport verde, sem regressões)
5. `grep "BrainOutputSchema" packages/core/src/index.ts` — exportado no barrel (Success Criteria 1)
6. `grep "Promise<BrainOutput | null>" packages/core/src/runner/runner.ts` — novo retorno (Success Criteria 2)
7. `grep "brainOutput" packages/ai/src/graph/state.ts` — campo no state (Success Criteria 2)
8. `grep "BrainRunResult" packages/core/src/runner/runner.ts` — NOT FOUND (removido — Success Criteria 3)
9. `grep "brainOutput" apps/brain-echo/src/brain.ts` — nó seta brainOutput (Success Criteria 4)

## Next Phase Readiness

- Fase 10 completa — todos os 4 critérios de success do ROADMAP §Phase 10 satisfeitos
- brain-sdr ainda retorna `{ reply: string }` no nó do grafo — receberá BrainOutputValidationError em runtime até a Fase 12 migrar o brain-sdr para o novo contrato
- O padrão duck typing local em transport pode ser reutilizado se outros transportes (RabbitMQ) precisarem da mesma interface sem import circular

---
*Phase: 10-output-parser-sdk*
*Completed: 2026-06-15*

---
## Self-Check: PASSED

- FOUND: apps/brain-echo/src/brain.ts
- FOUND: packages/transport/src/webhook/handler.ts
- FOUND: packages/transport/src/webhook/handler.test.ts
- FOUND: packages/transport/src/__tests__/unit/webhook-auth.test.ts
- FOUND: .planning/phases/10-output-parser-sdk/10-03-SUMMARY.md
- FOUND commit: ab115d7
- FOUND commit: dc90b2a
- Tests: 115 pass, 2 fail (pré-existentes), 0 fail causados por este plano
