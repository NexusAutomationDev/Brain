---
phase: quick-260803-g4j
plan: 01
subsystem: api
tags: [hono, langgraph, postgres-saver, debug-endpoint, admin-auth]

# Dependency graph
requires: []
provides:
  - "BrainRunner.injectMessage(threadId, content) — injects synthetic AIMessage into a thread's LangGraph checkpoint via updateState()"
  - "POST /debug/inject-message admin endpoint, mounted automatically in brain-sdr, brain-support and brain-echo via createCoreApp()"
affects: [brain-sdr, brain-support, brain-echo, fup-scheduler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debug/admin HTTP endpoints replicate the /reload-prompts security block verbatim (fail-closed 503, 401 without revealing which check failed) rather than extracting a shared helper"

key-files:
  created: []
  modified:
    - packages/core/src/runner/runner.ts
    - packages/core/src/server.ts
    - packages/core/src/__tests__/server.test.ts

key-decisions:
  - "injectMessage() calls compiledGraph.updateState() directly — no graph invoke, no LLM call — relying on BrainStateAnnotation.messages default [] to support threads without a prior checkpoint"
  - "content is never logged in either injectMessage() or the HTTP handler — only threadId, matching existing PII discipline in runner.ts"

patterns-established:
  - "New admin/debug endpoints in server.ts stay self-contained (duplicate the auth block) rather than sharing a middleware, following the existing /reload-prompts style"

requirements-completed: [D-1, D-2, D-3]

coverage:
  - id: D1
    description: "BrainRunner.injectMessage(threadId, content) injects an AIMessage via compiledGraph.updateState(), throwing ConfigurationError if the graph isn't compiled yet"
    requirement: "D-1"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/server.test.ts#POST /debug/inject-message (quick-260803-g4j, T-3-04-01, T-3-04-02) > valid token and body: injectMessage is called and 200 returned > calls runner.injectMessage(\"thread-abc\", \"olá\") exactly once"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /debug/inject-message enforces the same auth model as /reload-prompts: 503 fail-closed without ADMIN_TOKEN, 401 on missing/wrong X-Admin-Token"
    requirement: "D-2"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/server.test.ts#POST /debug/inject-message > T-3-04-02: fail closed when ADMIN_TOKEN env var is not configured"
        status: pass
      - kind: unit
        ref: "packages/core/src/__tests__/server.test.ts#POST /debug/inject-message > T-3-04-01: unauthorized access rejected with 401"
        status: pass
    human_judgment: false
  - id: D3
    description: "Malformed body (missing/empty/non-string threadId or content) returns 400 before injectMessage is ever called"
    requirement: "D-3"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/server.test.ts#POST /debug/inject-message > quick-260803-g4j D-3: malformed body rejected with 400"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-03
status: complete
---

# Quick Task 260803-g4j: Debug Message Injection Endpoint Summary

**Admin-only POST /debug/inject-message that writes a synthetic AIMessage straight into a LangGraph checkpoint via BrainRunner.injectMessage(), no LLM call involved**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `BrainRunner.injectMessage(threadId, content)` added — calls `compiledGraph.updateState()` with a new `AIMessage(content)`, works even for threads with no prior checkpoint (relies on `BrainStateAnnotation.messages` default `[]`)
- `POST /debug/inject-message` added to `createCoreApp()`, replicating the `/reload-prompts` security block line-for-line: 503 fail-closed when `ADMIN_TOKEN` is unset, 401 on missing/wrong `X-Admin-Token` without revealing which check failed, 400 on malformed `{ threadId, content }` body before touching the graph
- 16 new test cases covering 503/401/400/200 paths, asserting `injectMessage` is never called before all guards pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Método injectMessage() em BrainRunner** - `8423284` (feat)
2. **Task 2: Endpoint POST /debug/inject-message em server.ts** - `beedaca` (feat)
3. **Task 3: Testes do endpoint /debug/inject-message** - `79e80f0` (test)

## Files Created/Modified
- `packages/core/src/runner/runner.ts` - Added `injectMessage(threadId, content)` method (imports `AIMessage` from `@langchain/core/messages`)
- `packages/core/src/server.ts` - Added `POST /debug/inject-message` handler in `createCoreApp()`
- `packages/core/src/__tests__/server.test.ts` - Added `mockInjectMessage`, `makeInjectRequest()` helper, and a full `describe('POST /debug/inject-message', ...)` block

## Decisions Made
- Followed D-1/D-2/D-3 exactly as locked in the plan context — no deviation needed.
- Dependencies were not installed in the working tree at plan start (`node_modules` missing repo-wide); ran `pnpm install --frozen-lockfile` at repo root before the first `bun build` verification, since the plan's automated verify commands require compiled/resolved imports. This is environment setup, not a plan deviation — no lockfile or `package.json` changes were made.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Repo-wide `node_modules` was absent when execution started, causing the Task 1 `bun build` verification to fail with unresolved-import errors unrelated to the code change. Resolved by running `pnpm install --frozen-lockfile` (lockfile already up to date — no dependency version changes), then all three verification commands passed as specified.

## User Setup Required

None - no external service configuration required. The endpoint reuses the existing `ADMIN_TOKEN` env var already required for `/reload-prompts`; no new ENV needed.

## Next Phase Readiness
- Endpoint is live in `createCoreApp()`, automatically exposed in `brain-sdr`, `brain-support`, and `brain-echo` (all three mount `createCoreApp(runner)` at `/`).
- No blockers. Any Brain instance with `ADMIN_TOKEN` set can now be tested for FUP/continuity flows without waiting on a real LLM turn.

---
*Quick task: 260803-g4j*
*Completed: 2026-08-03*

## Self-Check: PASSED

All 3 modified files found on disk; all 3 task commits (8423284, beedaca, 79e80f0) found in git history.
