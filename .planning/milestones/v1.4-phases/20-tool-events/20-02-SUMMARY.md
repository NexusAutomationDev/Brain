---
phase: 20-tool-events
plan: "02"
subsystem: runner/events
tags: [brain-runner, event-publisher, tool-events, whitelist, fire-and-forget, tdd]

requires:
  - phase: 20-tool-events
    plan: "01"
    provides: IEventPublisher, ToolEvent, EventPublisher, NoopEventPublisher

provides:
  - BrainRunner integrado com EventPublisher (init/run/close)
  - TOOL_EVENTS_WHITELIST hardcoded com 3 tools (qualify_lead, pause_session, finish_conversation)
  - BrainRunnerOptions.eventPublisher opcional para injeção em testes (D-11)
  - Barrel packages/core/src/index.ts exportando IEventPublisher, ToolEvent, EventPublisher, NoopEventPublisher
  - 4 novos testes EVT (EVT-01 sem ENV, EVT-01 close injetado, EVT-02/EVT-04 whitelist + event_id)

affects:
  - packages/core/src/runner/runner.ts (modificado)
  - packages/core/src/index.ts (modificado)
  - packages/core/src/runner/__tests__/brain-runner.test.ts (modificado — 22 → 26 testes)

tech-stack:
  added: []
  patterns:
    - "TOOL_EVENTS_WHITELIST como Set<string> de módulo — fora da classe, recriação zero por request (T-20-07)"
    - "ToolMessage.isInstance() + typeof msg.name === 'string' — duplo guard contra undefined e não-ToolMessage"
    - "fire-and-forget: .catch() sem await no call site de run() — nunca bloqueia resposta ao lead (D-08)"
    - "D-11: eventPublisher injetável via BrainRunnerOptions — produção cria de ENVs, testes injetam mock"
    - "MockToolMessage no mock.module de @langchain/core/messages — ToolMessage.isInstance() funciona em testes"

key-files:
  created: []
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/index.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts

key-decisions:
  - "TOOL_EVENTS_WHITELIST como constante de módulo (não dentro de run()) — evita recriação do Set a cada invocação"
  - "MockToolMessage com static isInstance() no mock de @langchain/core/messages — ToolMessage.isInstance() em runner.ts reconhece instâncias nos testes"
  - "ToolMessage = MockToolMessage alias no arquivo de teste — permite new ToolMessage({...}) nos describes EVT sem import real"
  - "Symlinks de node_modules para execução de testes no worktree — rabbitmq-client linkado de packages/transport"

duration: 25min
completed: "2026-06-23"
---

# Phase 20 Plan 02: BrainRunner + EventPublisher Integration Summary

**BrainRunner integrado ao EventPublisher: init() cria publisher via ENVs, run() filtra ToolMessages da whitelist e publica fire-and-forget, close() fecha conexão; barrel export atualizado e 4 novos testes EVT adicionados**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-23T22:35:00Z
- **Completed:** 2026-06-23T23:00:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `runner.ts` modificado com integração completa do EventPublisher:
  - Import `ToolMessage` de `@langchain/core/messages`
  - Import `IEventPublisher`, `ToolEvent`, `EventPublisher` de `../events/event-publisher.js`
  - `TOOL_EVENTS_WHITELIST` como constante de módulo (`qualify_lead`, `pause_session`, `finish_conversation`)
  - `BrainRunnerOptions.eventPublisher?: IEventPublisher` para injeção em testes (D-11)
  - Campo privado `eventPublisher: IEventPublisher | null = null`
  - Construtor captura `options.eventPublisher` se presente
  - `init()`: cria e inicializa `EventPublisher` a partir de ENVs se não injetado
  - `run()`: filtra `result.messages` por `ToolMessage.isInstance()` + `typeof msg.name === "string"` + whitelist, publica fire-and-forget com `.catch()`
  - `close()`: chama `eventPublisher.close()` e limpa referência
- `index.ts` atualizado com bloco EVT-01 exportando `IEventPublisher`, `ToolEvent`, `EventPublisher`, `NoopEventPublisher`
- `brain-runner.test.ts` atualizado:
  - `MockToolMessage` com `static isInstance()` adicionado ao mock de `@langchain/core/messages`
  - 3 novos describe blocks: EVT-01 (sem ENV), EVT-01 (close injetado), EVT-02/EVT-04 (whitelist + event_id)
  - Suite cresceu de 22 para 26 testes

## Task Commits

1. **Task 1: Integrar EventPublisher no BrainRunner (init, run, close)** - `12f7ab2` (feat)
2. **Task 2: Atualizar barrel export e adicionar testes EVT** - `ffad562` (feat)

## Files Created/Modified

- `packages/core/src/runner/runner.ts` — BrainRunner com EventPublisher integrado em init/run/close + BrainRunnerOptions.eventPublisher + TOOL_EVENTS_WHITELIST de módulo
- `packages/core/src/index.ts` — Barrel atualizado exportando IEventPublisher, ToolEvent, EventPublisher, NoopEventPublisher
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — MockToolMessage no mock, 4 novos testes EVT (close injetado + EVT-01 sem ENV + EVT-02/EVT-04 whitelist)

## Decisions Made

- `TOOL_EVENTS_WHITELIST` fora do método `run()` como constante de módulo — evita recriação do `Set` a cada invocação, mínima penalidade de performance
- `MockToolMessage` com `static isInstance()` no mock de `@langchain/core/messages` — permite que `ToolMessage.isInstance(msg)` em `runner.ts` retorne `true` para instâncias de `MockToolMessage` nos testes
- Alias `const ToolMessage = MockToolMessage` no arquivo de teste — evita `await import()` top-level que causava problemas com bun test
- Symlinks de `node_modules` para worktree foram necessários para resolver `rabbitmq-client` (dependência transitiva de `packages/transport`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Objeto `lead` dentro de `toolEvents.push()` continha campo `result` duplicado**
- **Found during:** Task 1, ao editar o bloco de interceptação de ToolMessages
- **Issue:** Cópia incorreta do campo `result` para dentro do objeto `lead`, criando estrutura inválida para `ToolEvent`
- **Fix:** Removido campo `result` do objeto `lead` — mantido apenas no nível correto do `ToolEvent`
- **Files modified:** `packages/core/src/runner/runner.ts`
- **Commit:** incluído no `12f7ab2`

**2. [Rule 3 - Blocker] `rabbitmq-client` não resolvido no contexto do worktree**
- **Found during:** Task 1, ao executar testes do worktree
- **Issue:** worktree não tem `node_modules` próprio; `rabbitmq-client` está em `packages/transport/node_modules`, não em `packages/core/node_modules`
- **Fix:** Criados symlinks de `node_modules` para todos os pacotes do worktree apontando para o repo principal; adicionado symlink específico de `rabbitmq-client` em `packages/core/node_modules`
- **Files modified:** nenhum arquivo de código — apenas symlinks de runtime
- **Commit:** não commitado (symlinks de desenvolvimento, ignorados pelo `.gitignore`)

## Known Stubs

None.

## Threat Flags

Nenhuma nova superfície de ataque introduzida. As ameaças T-20-07 a T-20-10 cobertas no plan frontmatter foram implementadas conforme especificado:
- T-20-07 (Tampering): TOOL_EVENTS_WHITELIST hardcoded como Set de módulo — LLM não pode injetar novo nome
- T-20-08 (DoS): `.catch()` sem `await` no call site — run() retorna sem esperar publish
- T-20-09 (PII): `result = content raw` por design, documentado no event-publisher.ts
- T-20-10 (EoP): `eventPublisher` injetável apenas em contexto de teste; produção cria internamente em init()

## Self-Check: PASSED

**Files exist:**
- FOUND: `packages/core/src/runner/runner.ts`
- FOUND: `packages/core/src/index.ts`
- FOUND: `packages/core/src/runner/__tests__/brain-runner.test.ts`
- FOUND: `.planning/phases/20-tool-events/20-02-SUMMARY.md`

**Commits exist:**
- FOUND: `12f7ab2` — feat(20-02): integrar EventPublisher no BrainRunner
- FOUND: `ffad562` — feat(20-02): atualizar barrel export

**Tests:**
- 108 testes passando na suite do packages/core (worktree)
- 26 testes passando em brain-runner.test.ts (era 22 — 4 novos EVT adicionados)
- 0 falhas
