---
phase: 03-brain-sdk
plan: "03"
subsystem: core/runner
tags: [brain-sdk, runner, langgraph, memory, lifecycle]
dependency_graph:
  requires:
    - "03-01"  # IBrain, BrainBuildContext, ToolsRegistry
    - "03-02"  # loadPrompts, prompts table
  provides:
    - BrainRunner class with init/run/refreshPrompts
  affects:
    - packages/core/src/runner/runner.ts
    - packages/core/src/runner/__tests__/brain-runner.test.ts
tech_stack:
  added: []
  patterns:
    - TDD (RED→GREEN) with bun:test
    - mock.module() for dependency isolation
    - Fail-fast startup with process.exit(1)
    - LangGraph state isolation (run returns only { reply: string })
key_files:
  created:
    - packages/core/src/runner/runner.ts
  modified:
    - packages/core/src/runner/__tests__/brain-runner.test.ts
decisions:
  - "createLLM() is async — called inside _compileGraph() with await, not in BrainBuildContext sync construction"
  - "mock.module() path for loader must use ../../prompts/loader.js (relative to test file, not runner.ts)"
  - "BrainStateAnnotation imported but not used as type annotation on compiledGraph — any used to avoid complex generic inference"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-12"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 1
---

# Phase 03 Plan 03: BrainRunner Lifecycle Summary

## One-liner

BrainRunner orchestrates full conversation turns: init() loads prompts + compiles LangGraph with PostgresSaver, run(event) hydrates memory → invokes graph → returns { reply: string }, refreshPrompts() reloads DB prompts and recompiles graph.

## What Was Built

`packages/core/src/runner/runner.ts` — the SDK-02 host class that connects all domain packages into a single conversation turn cycle.

### BrainRunner class (SDK-02)

**Lifecycle:**
1. `new BrainRunner({ brain, sql, toolsRegistry, llmOptions })` — synchronous construction
2. `await runner.init()` — loads all promptKeys from DB via loadPrompts(), validates every key present (process.exit(1) if any missing), calls _compileGraph()
3. `await runner.run(event)` — per-request: getContext() → graph.invoke() → extract last AIMessage → saveContext() → return { reply }
4. `await runner.refreshPrompts()` — reloads prompts from DB AND recompiles graph (closures capture prompt snapshots)

**Key contracts enforced:**
- D-05: run() returns exclusively `{ reply: string }` — LangGraph state never leaks
- D-06: init() calls `process.exit(1)` on missing promptKey — fail-fast pattern
- D-07: refreshPrompts() calls `_compileGraph()` — recompilation mandatory
- AI-01: Only `createCheckpointer()` (PostgresSaver) in production code — zero MemorySaver imports
- T-3-03-04: Logger fields never include DATABASE_URL, API keys, or prompt content

**Tests (5 green):**
- `init()` loads prompts and compiles graph
- `init()` calls `process.exit(1)` on missing promptKey
- `run(event)` returns `{ reply: string }` with last AIMessage content
- `run(event)` returns only `["reply"]` keys (no state leak)
- `refreshPrompts()` calls loadPrompts again AND recompiles graph

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] createLLM() async signature mismatch**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan's `runner.ts` template called `createLLM(this.llmOptions)` synchronously, but the actual `packages/ai/src/llm/factory.ts` exports `createLLM` as `async function createLLM(...)`. Dynamic imports inside `createLLM` require async.
- **Fix:** Called `createLLM` with `await` inside `_compileGraph()` before constructing `BrainBuildContext`.
- **Files modified:** `packages/core/src/runner/runner.ts`
- **Commit:** 33d1b68

**2. [Rule 1 - Bug] mock.module() relative path mismatch**
- **Found during:** Task 1 (GREEN phase — first test run)
- **Issue:** Plan template used `mock.module("../prompts/loader.js", ...)` but mock.module paths are resolved relative to the test file (`src/runner/__tests__/`), not relative to the module under test (`src/runner/`). The correct path from the test file to loader is `../../prompts/loader.js`.
- **Fix:** Changed mock path to `"../../prompts/loader.js"` in the test file.
- **Files modified:** `packages/core/src/runner/__tests__/brain-runner.test.ts`
- **Commit:** 653a8ad

**3. [Rule 2 - Security] MemorySaver string in comments violated acceptance criteria**
- **Found during:** Task 1 post-implementation verification
- **Issue:** File header comments contained "MemorySaver" as documentation text. The acceptance criteria grep check `grep 'MemorySaver' runner.ts` must return zero results (any match = fail, regardless of context).
- **Fix:** Replaced comment text to remove the literal string "MemorySaver" while preserving the architectural intent.
- **Files modified:** `packages/core/src/runner/runner.ts`
- **Commit:** 33d1b68 (included in same commit)

### Infrastructure Fix

**Bun module resolution in git worktree:** The worktree's `packages/core` could not resolve `@langchain/core` because pnpm stores it under `packages/ai/node_modules`. Created a symlink: `packages/core/node_modules/@langchain → packages/ai/node_modules/@langchain`. This is a worktree-local fix; the main repo uses standard pnpm resolution without this issue.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. BrainRunner is an internal orchestrator class — no public surface added.

The threat mitigations from the plan's threat_model were verified:
- T-3-03-01: No MemorySaver in runner.ts (grep returns empty)
- T-3-03-02: run() returns only { reply: string } (test 4 verifies Object.keys)
- T-3-03-03: run() checks !compiledGraph and throws ConfigurationError
- T-3-03-04: Logger never logs DATABASE_URL, API keys, or prompt content

## Known Stubs

None. BrainRunner is fully implemented. The `queryVector: []` passed to `getContext()` means semantic search is skipped in v1 (no embedding of user input yet) — this is documented behavior, not a stub. The embedding pipeline is a future plan.

## Self-Check: PASSED

Files exist:
- `packages/core/src/runner/runner.ts` — FOUND
- `packages/core/src/runner/__tests__/brain-runner.test.ts` — FOUND

Commits exist:
- `653a8ad` — test commit (RED) — FOUND
- `33d1b68` — feat commit (GREEN) — FOUND

Tests: 5/5 passing, 0 failing.
