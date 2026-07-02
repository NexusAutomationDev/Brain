---
phase: 32-tech-debt-code-quality-cleanup
plan: 01
subsystem: infra
tags: [langgraph, rabbitmq, hono, bun-test, mock.module, sigterm, pgvector]

# Dependency graph
requires:
  - phase: 27-tech-debt-fixes
    provides: BRAIN_TOOLS/enabledTools whitelist, GET /health TransportStatus, FUP E2E test — the runtime lifecycle code this plan hardens
  - phase: 28-embedding-sdk
    provides: IEmbeddingProvider, createEmbeddingProvider() factory, atttypmod dimension-mismatch check in runner.ts init()
provides:
  - Idempotent SIGTERM registration in BrainRunner.init() — no listener accumulation across repeated init() calls
  - Defensive zero-row handling for the atttypmod dimension-check query in runner.ts (clear error instead of raw destructure crash)
  - Removal of the duplicate DATABASE_URL check in _compileGraph() (validated once in each Brain app's index.ts)
  - RabbitMQTransport retry-map key scoped by channel suffix (IDLead:Numero:rabbitmq) to prevent cross-message-type collision
  - WebhookTransport.getStatus() reflects real stopped state (connected:false after .stop())
  - brain-runner.test.ts no longer mocks @brain-pkg/embeddings directly — mocks @langchain/openai instead, matching factory.test.ts's safe pattern
affects: [33-tech-debt-remaining-cleanup, brain-support, brain-sdr]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mock.module() must target the underlying third-party SDK (e.g. @langchain/openai), never a workspace sibling package, to avoid global module-registry cross-pollution between test files run in the same bun test process"
    - "Idempotent handler registration: process.off(handler) before process.on(handler) whenever a setup method (init()) may be called more than once on the same instance"
    - "Retry/dedup map keys should be scoped by channel/message-type suffix, not just by business-entity pair, to avoid cross-type collisions as new channels are added"

key-files:
  created: []
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
    - packages/transport/src/rabbitmq/consumer.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/__tests__/unit/transport-status.test.ts
    - packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts

key-decisions:
  - "SIGTERM idempotency implemented as silent process.off()-before-process.on(), not a fail-fast guard rejecting repeated init() calls (per CONTEXT.md D-01)"
  - "atttypmod cross-version documentation comment added inline above the dimension-check query since this is the only place in the codebase reading atttypmod for a vector column"
  - "RabbitMQ retry-key channel suffix is the literal string 'rabbitmq' (this transport's only channel today) — establishes the IDLead:Numero:channel format for future multi-channel scenarios without inventing an unused parameter"
  - "WebhookTransport.getStatus() behavior change (connected:false after stop()) is intentional, matching the Phase 27 finding's described fix, and required updating the pre-existing test that asserted the opposite (always-true) behavior"
  - "brain-runner.test.ts keeps mocking embeddings-adjacent code (since not every BrainRunner instantiation in the file injects embeddingProvider explicitly) but switches the mock target from @brain-pkg/embeddings to @langchain/openai — letting the real createEmbeddingProvider()/OpenAIEmbeddingProvider factory code run under test, eliminating the D-13 cross-pollution root cause"

patterns-established:
  - "Test isolation for workspace packages: mock the external SDK a package wraps, not the package's own public API, when other test files in the same package/monorepo import that package directly"

requirements-completed: [TECH-06]

# Metrics
duration: 9min
completed: 2026-07-02
---

# Phase 32 Plan 01: Runtime Lifecycle Hardening & Test Isolation Fix Summary

**Fixed 3 real runtime-lifecycle defects (SIGTERM listener leak, RabbitMQ retry-key collision, WebhookTransport stale status) plus a confirmed-reproducing `mock.module` test cross-pollution bug between `brain-runner.test.ts` and `factory.test.ts`.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-02T01:51:10Z
- **Completed:** 2026-07-02T01:59:56Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `BrainRunner.init()` is now idempotent with respect to SIGTERM listener registration — calling `init()` twice never leaves two active handlers
- The `pg_attribute.atttypmod` dimension-mismatch query in `runner.ts` now fails with a clear, actionable error via `process.exit(1)` instead of crashing with a raw `TypeError: Cannot destructure property 'dimensions' of 'undefined'` when `knowledge_chunks` hasn't been migrated yet
- Removed the redundant duplicate `DATABASE_URL` check inside `_compileGraph()` — already validated once in each Brain app's `index.ts` before `init()` is ever called
- `RabbitMQTransport`'s retry-map key now includes a `:rabbitmq` channel suffix, closing a collision window where two different message types sharing the same `IDLead:Numero` pair could silently share (and corrupt) a retry counter
- `WebhookTransport.getStatus()` now returns `connected: false` after `.stop()` is called, instead of always reporting `connected: true` — fixes a `/health` accuracy gap
- Confirmed (via direct reproduction) and fixed the `mock.module` cross-pollution between `brain-runner.test.ts` and `packages/embeddings/src/__tests__/unit/factory.test.ts` — running both files together in one `bun test` process now produces 0 failures (previously 3)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix SIGTERM idempotency and defensive dimension-query handling in runner.ts** - `0455080` (fix, tdd=true)
2. **Task 2: Fix RabbitMQ retry-map key collision and WebhookTransport stale status** - `7b4f32c` (fix, tdd=true)
3. **Task 3: Fix mock.module cross-pollution between brain-runner.test.ts and factory.test.ts** - `40a14c9` (test)

_Note: All three tasks were completed with tests written/updated alongside the implementation change in the same commit (single-commit-per-task style, consistent with the rest of this codebase's task commit pattern)._

## Files Created/Modified
- `packages/core/src/runner/runner.ts` — idempotent SIGTERM registration, guarded atttypmod zero-row handling, atttypmod cross-version doc comment, removed duplicate DATABASE_URL check in `_compileGraph()`
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — added SIGTERM idempotency test (D-01) and zero-row atttypmod test (D-07); replaced `mock.module("@brain-pkg/embeddings", ...)` with a `@langchain/openai` mock (D-13); reworked 3 EMBD-05 tests (Test 1/2/3) to work against the real `createEmbeddingProvider()` code path instead of a removed spy
- `packages/transport/src/rabbitmq/consumer.ts` — retry-map key now `${IDLead}:${Numero}:rabbitmq` instead of `${IDLead}:${Numero}`
- `packages/transport/src/webhook/handler.ts` — added `stopped` flag; `getStatus()` returns `connected: !this.stopped`
- `packages/transport/src/__tests__/unit/transport-status.test.ts` — updated Test 2 to assert `connected: false` after `stop()` (behavior change per D-03); added Test 2b for stop()-before-start() safety
- `packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts` — added a D-02 test confirming retry-count behavior is preserved within the single existing channel after the key-format change

## Decisions Made
- Kept `mock.module` in `brain-runner.test.ts` (rather than deleting it entirely) because not every `new BrainRunner(...)` call site in the file injects `embeddingProvider` explicitly — deleting the mock outright would have required threading `embeddingProvider: mockEmbeddingProvider` through ~30 call sites for tests that don't care about embedding behavior. Instead, the mock target was moved one layer down to `@langchain/openai` (the actual external SDK `OpenAIEmbeddingProvider` wraps), which is exactly the safe pattern `factory.test.ts` already uses and does not leak between test files.
- For the 3 EMBD-05 tests that specifically exercised the "no embeddingProvider injected" code path (Test 1, Test 2, Test 3 in the "embeddingProvider injection + dimension fail-fast" describe block), rewrote them to assert against the real `createEmbeddingProvider()`/`OpenAIEmbeddingProvider` behavior (via `spyOn` for ordering, and direct mock-provider call assertions for the injection test) rather than a module-level spy that no longer exists.
- Used the literal channel suffix `"rabbitmq"` for the retry-map key (not a parameterized/dynamic value) since `RabbitMQTransport` only has one message channel today — this establishes the `IDLead:Numero:channel` format for future multi-channel scenarios without inventing unused abstraction.

## Deviations from Plan

None — plan executed as written. The two scope corrections noted in the plan's `<objective>` (Phase 27 WR-01 dead-branch claim and IN-01 `as any` claim) were pre-confirmed by the planner as not reproducing and required no action here.

## Issues Encountered
- Task 3's plan draft (interfaces block, Test 3 for D-13) assumed `createEmbeddingProvider` could be tracked via the removed `mock.module` spy. Since removing `mock.module("@brain-pkg/embeddings", ...)` also removes that spy, Test 3 (ordering assertion) was rewritten using `bun:test`'s `spyOn()` against the real `@brain-pkg/embeddings` module namespace import — confirmed this correctly intercepts the live ESM binding used inside `runner.ts` (all 38 tests plus the 11-test `factory.test.ts` baseline pass, and the 49-test combined run passes with 0 failures).
- The monorepo's `node_modules` and package `dist/` outputs were not present in this worktree at the start of execution — ran `pnpm install --frozen-lockfile` and `pnpm -r build` once before running any tests/typechecks (required for `tsc --noEmit`'s project-reference resolution across `packages/*`). This was a one-time environment setup step, not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 3 tasks' acceptance criteria verified via grep and test run (see task commits for exact commands/output)
- Full plan-level verification suite passes: `bun test` for `brain-runner.test.ts`, `transport-status.test.ts`, and the combined `brain-runner.test.ts` + `factory.test.ts` run; `pnpm --filter @brain-pkg/core typecheck`, `pnpm --filter @brain-app/sdr typecheck`, `pnpm --filter @brain-app/support typecheck` — all exit 0
- No blockers for subsequent Phase 32 plans (32-02 through 32-05)

---
*Phase: 32-tech-debt-code-quality-cleanup*
*Completed: 2026-07-02*

## Self-Check: PASSED

All 6 modified source/test files confirmed present on disk. All 3 task commit hashes (`0455080`, `7b4f32c`, `40a14c9`) confirmed present in `git log --oneline --all`.
