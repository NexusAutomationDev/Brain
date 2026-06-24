---
phase: 22-fup-autom-tico
plan: "02"
subsystem: scheduler
tags: [fup, scheduler, langgraph, postgres, timezone, rabbitmq, events]

requires:
  - phase: 22-01
    provides: "fup_failure_count column in leads table via migration 0008"
  - phase: 20-tool-events
    provides: "IEventPublisher interface and EventPublisher implementation"
  - phase: 19-database-foundation
    provides: "fup_config table, fupEnabled/fupStep/fupNextAt columns in leads"

provides:
  - "FupScheduler class implementing IFupScheduler (start/stop lifecycle)"
  - "getNextValidSlot() function for IANA timezone-aware slot calculation"
  - "ICheckpointerLike interface for decoupled checkpointer injection"
  - "Unit tests covering FUP-01 through FUP-08 and EVT-03 behaviors"

affects:
  - 22-03
  - BrainRunner integration (Plan 03 integrates FupScheduler into lifecycle)

tech-stack:
  added: []
  patterns:
    - "Two-transaction pattern for SELECT FOR UPDATE SKIP LOCKED with slow I/O outside transaction"
    - "ICheckpointerLike interface avoids direct dependency on @langchain/langgraph-checkpoint-postgres from packages/core"
    - "Intl.DateTimeFormat.formatToParts() with parseInt % 24 normalization for timezone-aware slot calculation"
    - "monkey-patch _sendFupWebhook in unit tests to inject fetchMock without global state"

key-files:
  created:
    - packages/core/src/fup/fup-scheduler.ts
    - packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts
    - packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts
  modified: []

key-decisions:
  - "ICheckpointerLike interface used instead of direct PostgresSaver import — packages/core does not declare @langchain/langgraph-checkpoint-postgres as direct dependency (it's transitive via @brain-pkg/ai)"
  - "Two-transaction pattern adopted: Tx1 (SELECT FOR UPDATE SKIP LOCKED + UPDATE fup_next_at=NOW()+10min) closes immediately; LLM+HTTP run outside; Tx2 commits final state — prevents pool starvation on slow I/O"
  - "Test isolation via monkey-patching _sendFupWebhook instead of globalThis.fetch mock — avoids cross-test contamination from fire-and-forget publish calls"

patterns-established:
  - "Pattern: Two-transaction SKIP LOCKED — SELECT FOR UPDATE in short Tx1 marks in-processing immediately, slow I/O outside tx, Tx2 commits final result"
  - "Pattern: IXxxLike structural interfaces for external types not directly available in packages/core"

requirements-completed:
  - FUP-01
  - FUP-02
  - FUP-03
  - FUP-05
  - FUP-07
  - FUP-08
  - EVT-03

duration: 20min
completed: 2026-06-24
---

# Phase 22 Plan 02: FupScheduler Summary

**FupScheduler background scheduler with SELECT FOR UPDATE SKIP LOCKED, LLM one-shot via PostgresSaver.getTuple, IANA timezone slot calculation via Intl.DateTimeFormat, retry counter in DB, and EVT-03 fire-and-forget via IEventPublisher**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-24T00:26:20Z
- **Completed:** 2026-06-24T00:39:45Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- `FupScheduler` implementado com ciclo de vida `start()/stop()` e interface `IFupScheduler`
- `_tick()` usa padrão de duas transações: Tx1 curta (SELECT FOR UPDATE SKIP LOCKED + UPDATE marcação), I/O lento (LLM + HTTP) fora da transação, Tx2 para commit final
- `getNextValidSlot()` calcula próximo slot válido via `Intl.DateTimeFormat.formatToParts()` com normalizações IANA (pitfall '24' → 0)
- 16/16 testes unitários passando cobrindo FUP-02, FUP-05, FUP-07, FUP-08, EVT-03, D-13, D-18

## Task Commits

1. **Task 1: FupScheduler implementation** - `5d5c96f` (feat)
2. **Task 2: Unit tests** - `86c4402` (test)

## Files Created/Modified

- `packages/core/src/fup/fup-scheduler.ts` — FupScheduler class, IFupScheduler interface, ICheckpointerLike interface, getNextValidSlot function
- `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` — 10 testes cobrindo regras de negócio do scheduler
- `packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts` — 6 testes de getNextValidSlot com timezones IANA reais

## Decisions Made

- **ICheckpointerLike em vez de PostgresSaver direto:** `packages/core` não declara `@langchain/langgraph-checkpoint-postgres` como dependência direta (é transitiva via `@brain-pkg/ai`). Usar uma interface estrutural local com apenas o método `getTuple` necessário resolve o erro TS sem modificar o `package.json`.

- **Duas transações (padrão consolidado):** A questão em aberto RESEARCH.md "Open Questions 3" foi resolvida adotando: (1) Tx1 curta faz SELECT FOR UPDATE SKIP LOCKED + UPDATE `fup_next_at=NOW()+10min` e fecha; (2) LLM e HTTP rodam fora da transação sem bloquear o pool; (3) Tx2 faz o UPDATE definitivo. Outras instâncias não veem o lead até o UPDATE final.

- **Monkey-patch de `_sendFupWebhook` nos testes:** Injetar `fetchMock` via `globalThis.fetch` causava contaminação entre testes (mocks fire-and-forget pendentes). A solução foi sobrescrever o método `_sendFupWebhook` diretamente no scheduler após construção, isolando o mock por teste.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ICheckpointerLike interface para evitar dependência direta de @langchain/langgraph-checkpoint-postgres**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** O plan especificava `import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"`, mas esse módulo não está em `packages/core/package.json` (apenas em `packages/ai`). Causava erro TS2307.
- **Fix:** Criada interface local `ICheckpointerLike` com apenas `getTuple()`, substituindo a importação direta. `PostgresSaver` do mundo real satisfaz essa interface estruturalmente.
- **Files modified:** `packages/core/src/fup/fup-scheduler.ts`
- **Verification:** Erro TS2307 eliminado; testes passam com o tipo real em runtime
- **Committed in:** `5d5c96f` (Task 1 commit)

**2. [Rule 1 - Bug] Correção do bug ?? vs !== undefined no mock de teste**
- **Found during:** Task 2 (teste D-13 falhando)
- **Issue:** `options.promptContent ?? "default"` trata `null` e `undefined` identicamente — quando `promptContent: null` era passado, o fallback string era aplicado e o prompt retornava conteúdo, impedindo o teste de verificar o warn.
- **Fix:** Substituído por `options.promptContent !== undefined ? options.promptContent : "default"` para distinguir `null` (explicitamente sem prompt) de `undefined` (não fornecido).
- **Files modified:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts`
- **Verification:** Teste D-13 passou com `warnCalled === true` e `fetchMock` não chamado
- **Committed in:** `86c4402` (Task 2 commit)

**3. [Rule 3 - Blocking] Instalação de node_modules no worktree para execução de testes**
- **Found during:** Task 2 (module resolution failure)
- **Issue:** O worktree git não tinha `node_modules`, impedindo o bun de resolver `@langchain/core/messages` e outras dependências durante os testes.
- **Fix:** `bun install --frozen-lockfile` executado no `packages/core` do worktree.
- **Files modified:** `packages/core/node_modules/` (não commitado — gitignored)
- **Verification:** `bun test packages/core/src/__tests__/unit/fup/` passou com 16/16
- **Committed in:** N/A (node_modules não são commitados)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking)
**Impact on plan:** Todos necessários para corretude e execução dos testes. Sem scope creep.

## Issues Encountered

- **Worktree sem node_modules:** Git worktrees são checkouts isolados sem `node_modules`. O bun resolve dependências subindo a árvore de diretórios a partir do arquivo fonte — sem `node_modules` no worktree, tudo falha. Solução: `bun install` no pacote do worktree.
- **globalThis.fetch contaminação cross-test:** Mocks fire-and-forget (`eventPublisher.publish`) podiam completar após o teste terminar, incrementando o count do mock `fetch` de testes subsequentes. Solução: monkey-patch de `_sendFupWebhook` por teste.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: pii_logging | packages/core/src/fup/fup-scheduler.ts | T-22-03 implementado: apenas `uniqueId` logado em warn/error, nunca conteúdo da mensagem gerada por LLM |
| threat_flag: url_logging | packages/core/src/fup/fup-scheduler.ts | T-22-04 implementado: `start()` loga apenas `hasFupUrl: true`, nunca a URL completa |

## Next Phase Readiness

- `FupScheduler` pronto para integração no `BrainRunner` (Plan 03)
- `ICheckpointerLike` pode ser injetado com `PostgresSaver` real (estruturalmente compatível)
- `getNextValidSlot` exportada e testada isoladamente — disponível para uso direto
- Pendente (Plan 03): integrar FupScheduler no `BrainRunner.init()/close()`, adicionar `LeadService.resetFup()`, e exportar via `packages/core/src/index.ts`

## Self-Check

- [x] `packages/core/src/fup/fup-scheduler.ts` existe
- [x] `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` existe
- [x] `packages/core/src/__tests__/unit/fup/fup-business-hours.test.ts` existe
- [x] Commit `5d5c96f` existe no git log
- [x] Commit `86c4402` existe no git log
- [x] 16/16 testes passando

## Self-Check: PASSED

---
*Phase: 22-fup-autom-tico*
*Completed: 2026-06-24*
