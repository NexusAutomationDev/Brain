---
phase: 33-seed-por-tipo-de-brain
plan: 03
subsystem: infra
tags: [langgraph, fup-scheduler, checkpoint, brain-runner, fire-and-forget]

# Dependency graph
requires:
  - phase: 33-seed-por-tipo-de-brain (Plan 33-01)
    provides: SEEDS_FOLDER wiring in runner.ts that this plan's edit to the same file builds on top of
provides:
  - FupSchedulerOptions.injectMessage — required callback wired to BrainRunner.injectMessage()
  - FupScheduler now persists every successfully-sent FUP message into the lead's LangGraph checkpoint
affects: [34-fundacao-de-handoff, 35-execucao-de-handoff]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget-with-warn for a new checkpoint write path — .catch() logs a warning and never blocks the caller's already-successful side effect (mirrors eventPublisher.publish().catch())"

key-files:
  created: []
  modified:
    - packages/core/src/fup/fup-scheduler.ts
    - packages/core/src/runner/runner.ts
    - packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts
    - packages/core/src/__tests__/integration/fup-e2e.test.ts

key-decisions:
  - "injectMessage made a REQUIRED field on FupSchedulerOptions (not optional) — forces every construction site to explicitly decide what happens on checkpoint writes, rather than silently no-op-ing"
  - "Fixed the fup-e2e.test.ts integration test's FupScheduler construction (not listed in the plan's files_modified) with a no-op injectMessage mock — required because the new field is non-optional and this call site would otherwise throw at runtime when DATABASE_URL is set (Rule 3 — blocking issue directly caused by this plan's interface change)"

patterns-established:
  - "New checkpoint write paths from background schedulers follow the same fire-and-forget-with-warn discipline already used for eventPublisher.publish().catch() — a side-channel write failure never unwinds an already-confirmed primary action"

requirements-completed: [SEED-03]

coverage:
  - id: D1
    description: "FupScheduler injects the sent FUP message into the lead's LangGraph checkpoint via opts.injectMessage() right after a successful webhook send"
    requirement: "SEED-03"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts#D-10: após envio bem-sucedido, injectMessage é chamado com (lead.uniqueId, message)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A rejected injectMessage() call is caught, logged as a warning with only lead.uniqueId (never message content), and never blocks the fup_step/fup_next_at UPDATE"
    requirement: "SEED-03"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts#D-10: falha em injectMessage não impede o avanço de fup_step"
        status: pass
    human_judgment: false
  - id: D3
    description: "BrainRunner wires its own injectMessage() (compiledGraph.updateState()) into every FupScheduler instance it creates, no new LangGraph mechanics introduced"
    requirement: "SEED-03"
    verification:
      - kind: unit
        ref: "packages/core/src/runner/runner.ts:241-249 (injectMessage: this.injectMessage.bind(this)); existing runner-fup.test.ts suite passes unaffected"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-08-13
status: complete
---

# Phase 33 Plan 3: FUP Checkpoint Persistence (D-10) Summary

**FupScheduler now writes the FUP message it just sent into the lead's LangGraph checkpoint via BrainRunner's existing `compiledGraph.updateState()` primitive, so the next real LLM turn sees it as conversation history.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 4 (3 planned + 1 out-of-scope test fixture fix, see Deviations)

## Accomplishments
- `FupSchedulerOptions` gained a required `injectMessage(threadId, content): Promise<void>` field
- `_processFupForLead()` now calls `this.opts.injectMessage(lead.uniqueId, message)` immediately after a successful webhook send, wrapped in `.catch()` so a checkpoint-write failure never blocks the already-successful `fup_step`/`fup_next_at` UPDATE
- `BrainRunner.init()` wires `injectMessage: this.injectMessage.bind(this)` into every `FupScheduler` it constructs, reusing the `compiledGraph` already compiled earlier in `init()` — no new LangGraph mechanics
- Warning log on `injectMessage` failure includes only `lead.uniqueId`, never the message content (T-33-04/T-22-03 discipline)
- Two new D-10 unit tests cover the happy path (injectMessage called with exact `uniqueId`/message) and the non-blocking failure path (rejection caught, `fup_step` UPDATE still runs)

## Task Commits

Each task was committed atomically:

1. **Task 1: FupScheduler persists the sent FUP message to the checkpoint (D-10)** - `af329d1` (feat)
2. **Task 2: Wire BrainRunner's injectMessage into FupScheduler + update tests** - `d56027e` (feat)

_Note: This plan's tasks were `type="auto"` (Task 1 marked `tdd="true"` in frontmatter but implemented as a direct add-and-verify against existing test infrastructure, consistent with how the plan's `<action>`/`<verify>` were written — no separate RED-only commit was required by the plan's own task structure)._

## Files Created/Modified
- `packages/core/src/fup/fup-scheduler.ts` - `FupSchedulerOptions.injectMessage` field + fire-and-forget-with-warn call site in `_processFupForLead()`
- `packages/core/src/runner/runner.ts` - `injectMessage: this.injectMessage.bind(this)` wired into the `FupScheduler` instantiation block
- `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts` - `makeScheduler()` helper gains an `injectMessage` mock exposed as `injectMessageMock`; two new D-10 test cases
- `packages/core/src/__tests__/integration/fup-e2e.test.ts` - added a no-op `injectMessage` mock to its `FupScheduler` construction (out-of-plan call site broken by the new required field, see Deviations)

## Decisions Made
- `injectMessage` is a required (not optional) field on `FupSchedulerOptions`, matching the plan's explicit instruction — this surfaces every construction site immediately rather than letting a missing wiring silently no-op.
- No new test file was added for the runner wiring itself; the existing `runner-fup.test.ts` suite (which doesn't set `FUP_WEBHOOK_URL`, so `FupScheduler` is never constructed in that suite) continues to pass unmodified, confirming no regression to the unrelated `touchLastMessage()` gate behavior it covers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed fup-e2e.test.ts's FupScheduler construction, broken by the new required field**
- **Found during:** Task 2 (post-implementation sweep for all `new FupScheduler({...})` call sites)
- **Issue:** `packages/core/src/__tests__/integration/fup-e2e.test.ts` (not listed in this plan's `files_modified`) also constructs `FupScheduler` directly. Once `injectMessage` became a required field (Task 1), this call site would throw at runtime (`this.opts.injectMessage is not a function`) the moment a successful FUP send occurred — a real functional break for anyone running this DB-backed integration test with `DATABASE_URL` set, even though `bun`'s type-stripping transpiler doesn't flag it as a compile error.
- **Fix:** Added a no-op `injectMessage: async (_threadId, _content) => {}` mock to the test's `FupScheduler` construction. This test's scope is send/scheduling behavior (FUP-02/FUP-05), not checkpoint persistence, so a no-op is correct and doesn't dilute its existing assertions.
- **Files modified:** `packages/core/src/__tests__/integration/fup-e2e.test.ts`
- **Verification:** `bun test src/__tests__/integration/fup-e2e.test.ts` — 3 tests skip gracefully (no `DATABASE_URL` in this environment), confirming no syntax/runtime error in the updated construction; ran alongside the unit and runner suites for a combined 55 pass / 3 skip / 0 fail.
- **Committed in:** `d56027e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for correctness of an existing test call site the interface change touched; no scope creep into checkpoint-persistence testing for that file.

## Issues Encountered
None beyond the deviation above.

## Known Stubs
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- D-10 fully implemented and tested; SEED-03's "FUP out-of-the-box" success criterion is now deepened to include checkpoint visibility for the Brain's own LLM.
- Phase 33 (all 3 plans) complete. Phases 34/35 (Handoff foundation/execution) can proceed — no blockers introduced by this plan.
- Pre-existing `mock.module()` full-suite test pollution (`packages/core`'s `lead-service-fup.test.ts` and others) remains open and untouched, as documented in `.planning/phases/33-seed-por-tipo-de-brain/deferred-items.md` and `STATE.md`'s Pending Todos — confirmed via isolated run (12/12 pass) that this plan's changes are not the cause.

---
*Phase: 33-seed-por-tipo-de-brain*
*Completed: 2026-08-13*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (`af329d1`, `d56027e`) verified present in git log.
