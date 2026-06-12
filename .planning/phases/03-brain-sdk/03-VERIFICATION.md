---
phase: 03-brain-sdk
verified: 2026-06-12T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "BrainRunner.run() end-to-end with a real PostgreSQL database"
    expected: "Event received → memory hydrated → LangGraph graph invoked → AIMessage extracted → memory persisted → { reply: string } returned with no state leak"
    why_human: "Tests use mock.module() for all dependencies. The full call path (PostgresSaver checkpointer, MemoryManager with real DB, graph compilation) cannot be confirmed without a running PostgreSQL instance."
  - test: "POST /reload-prompts returns 401 with wrong X-Admin-Token and 200 with correct token (ADMIN_TOKEN env set)"
    expected: "401 response when token absent or wrong; 200 + refreshPrompts() called when token matches ADMIN_TOKEN"
    why_human: "No integration test exists for this endpoint. The implementation reads process.env.ADMIN_TOKEN at request time, which requires a live Hono server and env configuration."
  - test: "WebhookHandler wires BrainRunner end-to-end"
    expected: "POST /api/v1/webhook with valid BrainEvent and runner injected returns { status: 'ok', reply: '<AI response>' }"
    why_human: "Transport tests verify the fallback path (no runner), but the runner-injected path is tested only via type-system duck typing. No integration test verifies the full wired path."
---

# Phase 3: Brain SDK Verification Report

**Phase Goal:** `packages/core` exposes a stable `IBrain` contract, a `BrainRunner` that wires all domain packages, and a `ToolsRegistry` — ready for Brain implementations to be registered and executed
**Verified:** 2026-06-12
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A minimal Brain object implementing `IBrain` can be registered in `BrainRegistry` and resolved by ID | VERIFIED | `BrainRegistry.register()` and `resolve()` implemented with ConfigurationError on duplicate/missing; 3 passing tests confirm all cases |
| 2 | `BrainRunner.run(event)` receives a BrainEvent, hydrates memory, invokes graph, persists memory, returns `{ reply: string }` with no MemorySaver in call path | VERIFIED | `runner.ts` lines 132, 141, 162, 168 implement full lifecycle; zero MemorySaver references in production code; 5 tests pass |
| 3 | `ToolsRegistry` enables/disables tools by brainType; unregistered brainType throws an error | VERIFIED | `getTools()` throws `ConfigurationError` when brainType not in registry Map; `enableTool()`/`disableTool()` manage whitelist Set; 5 tests pass |
| 4 | All prompts used by `BrainRunner` are loaded from the `prompts` DB table via `promptKeys` at startup; no prompt strings in package source | VERIFIED | `loadPrompts()` queries `and(eq(brainType), inArray(key, keys))`; grep confirms zero hardcoded prompt strings in production `.ts` files |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/brain/interface.ts` | IBrain interface + BrainBuildContext type | VERIFIED | Exports `IBrain`, `BrainBuildContext`; `buildGraph()` returns uncompiled `StateGraph` |
| `packages/core/src/brain/registry.ts` | BrainRegistry class with register() and resolve() | VERIFIED | Class with Map-based storage; ConfigurationError on duplicate/missing |
| `packages/core/src/tools/registry.ts` | ToolsRegistry class with enable/disable/getTools | VERIFIED | Map<brainType, Set<toolName>> whitelist; ConfigurationError for unregistered brainType |
| `packages/core/src/runner/runner.ts` | BrainRunner with init(), run(), refreshPrompts() | VERIFIED | Full lifecycle implemented; process.exit(1) on missing promptKey; _compileGraph() called in both init + refreshPrompts |
| `packages/core/src/prompts/loader.ts` | loadPrompts() function | VERIFIED | Drizzle query with double filter; returns Record<string, string>; early return {} for empty keys |
| `packages/core/src/index.ts` | Barrel export of packages/core | VERIFIED | Exports IBrain, BrainBuildContext, BrainRegistry, BrainRunner, BrainRunnerOptions, BrainRunResult, ToolsRegistry, loadPrompts |
| `packages/core/src/server.ts` | createCoreApp(runner) with /reload-prompts | VERIFIED | X-Admin-Token auth; 401 on bad token; 503 when ADMIN_TOKEN not set; calls runner.refreshPrompts() |
| `packages/transport/src/webhook/handler.ts` | WebhookHandler wired with BrainRunner | VERIFIED | IBrainRunnerLike duck type avoids circular dep; runner.run(event) called; { status: "ok", reply } returned |
| `packages/database/src/schema/tables.ts` | prompts table with UNIQUE(brain_type, key) | VERIFIED | Table defined with all required columns + uniqueIndex on (brain_type, key) |
| `packages/database/src/migrations/0001_lazy_deathstrike.sql` | Migration SQL for prompts table | VERIFIED | CREATE TABLE "prompts" with all columns; CREATE UNIQUE INDEX prompts_brain_type_key_idx |
| `packages/core/package.json` | @brain-pkg/core workspace package | VERIFIED | name: @brain-pkg/core; 6 workspace dependencies declared |
| `packages/core/tsconfig.json` | tsconfig extending base with project references | VERIFIED | 6 project references (shared, ai, memory, database, transport, observability) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tsconfig.base.json` | `packages/core/src` | path alias `@brain-pkg/core` | VERIFIED | `"@brain-pkg/core": ["packages/core/src"]` confirmed |
| `runner.ts` | `brain/interface.ts` | `import { IBrain, BrainBuildContext }` | VERIFIED | Relative import on line 19 |
| `runner.ts` | `@brain-pkg/ai` | `createCheckpointer, createLLM, BrainStateAnnotation` | VERIFIED | Import on line 9; createCheckpointer called in _compileGraph |
| `runner.ts` | `@brain-pkg/memory` | `MemoryManager` | VERIFIED | Import on line 11; used in _compileGraph + run() |
| `runner.ts` | `prompts/loader.ts` | `loadPrompts` | VERIFIED | Import on line 21; called in init() and refreshPrompts() |
| `runner.ts` | `@brain-pkg/observability` | `createTracingCallbacks, createLogger` | VERIFIED | Imports on lines 12-13; callbacks used in run() |
| `loader.ts` | `@brain-pkg/database` | `import { prompts }` | VERIFIED | Import on line 9; used in Drizzle select query |
| `loader.ts` | `drizzle-orm/postgres-js` | `drizzle(sql)` | VERIFIED | Import on line 7; db created per-call |
| `server.ts` | `runner.ts` | `runner.refreshPrompts()` | VERIFIED | Called on line 42 when auth passes |
| `handler.ts` | `runner.ts` (duck typed) | `runner.run(event)` via IBrainRunnerLike | VERIFIED | Line 62; result.reply returned on line 63; no @brain-pkg/core import (circular dep avoided) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `runner.ts` | `this.prompts` | `loadPrompts(sql, brainType, promptKeys)` → Drizzle query | Yes — Drizzle `inArray` query against DB `prompts` table | FLOWING |
| `runner.ts` | `result` from `compiledGraph.invoke()` | LangGraph compiled graph execution | Yes — compiled graph with PostgresSaver checkpointer | FLOWING (mocked in tests; real in production) |
| `runner.ts` | `reply` | `lastAI.content` extracted from `result.messages` | Yes — last AIMessage content string | FLOWING |
| `loader.ts` | `rows` | Drizzle `db.select().from(prompts).where(...)` | Yes — parametrized SQL query | FLOWING |
| `handler.ts` | `result.reply` | `runner.run(event)` returning `BrainRunResult` | Yes — flows from BrainRunner to JSON response | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 16 tests pass across 4 core files | `bun test packages/core/src` | 16 pass, 0 fail, 25 expect() calls | PASS |
| 15 tests pass for transport package | `bun test packages/transport/src` | 15 pass, 0 fail, 21 expect() calls | PASS |
| No MemorySaver in production runner | `grep 'MemorySaver' packages/core/src/runner/runner.ts` | 0 matches | PASS |
| No hardcoded prompt strings | `grep -r 'you are a\|system prompt\|você é' packages/core/src --include="*.ts" --exclude="*.test.ts"` | 0 matches | PASS |
| All 13 summary commits exist in git | `git show --oneline <hash>` for each | All 13 commits found | PASS |
| Migration SQL contains all required elements | File contents | CREATE TABLE + CREATE UNIQUE INDEX both present | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SDK-01 | 03-01-PLAN.md | IBrain interface with id, promptKeys[], tools[], buildGraph() | SATISFIED | `interface.ts` exports IBrain + BrainBuildContext; `registry.ts` exports BrainRegistry; 3 tests green |
| SDK-02 | 03-03-PLAN.md | BrainRunner host wiring memory, checkpointer, tools, transport | SATISFIED | `runner.ts` exports BrainRunner with init/run/refreshPrompts; process.exit(1) on missing prompt; 5 tests green |
| SDK-03 | 03-01-PLAN.md | ToolsRegistry with enable/disable per Brain type | SATISFIED | `tools/registry.ts` exports ToolsRegistry with whitelist Map; ConfigurationError for unregistered type; 5 tests green |
| SDK-04 | 03-02-PLAN.md | All prompts stored in DB table, no hardcoded prompts | SATISFIED | `loader.ts` queries prompts table; migration SQL generated; zero hardcoded strings confirmed by grep |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/prompts/loader.ts` | 31 | `return {}` | Info | Early return for empty keys array — this is a valid guard clause, not a stub; function returns real data in all other cases |
| `packages/core/src/runner/runner.ts` | 58 | `private compiledGraph: any \| null = null` | Warning | Type erasure via `any` for compiledGraph — intentional workaround for complex LangGraph generic inference; does not affect runtime behavior but reduces type safety |

Neither pattern is a blocker. The `return {}` is a correct early-exit guard. The `any` is documented with an eslint disable comment and architectural rationale.

### Human Verification Required

#### 1. BrainRunner End-to-End Conversation Turn

**Test:** Start a local PostgreSQL instance with the `prompts` table populated (via the migration SQL), create a minimal IBrain implementation, construct a BrainRunner with a real Sql connection and ToolsRegistry, call `await runner.init()`, then `await runner.run(event)` with a BrainEvent.

**Expected:** No process.exit(1) fires; init() completes; run() returns `{ reply: "<non-empty string>" }`; result has exactly one key (`reply`); memory manager methods are called in order (getContext before invoke, saveContext after).

**Why human:** All dependencies (createCheckpointer, MemoryManager, createLLM, createTracingCallbacks, loadPrompts) are mocked in unit tests. The full call path through PostgresSaver, MemoryManager with a real DB, and LangGraph graph compilation has not been exercised in an integration test.

#### 2. POST /reload-prompts Authentication

**Test:** Start a Hono server with `createCoreApp(runner)`, send `POST /reload-prompts` without `X-Admin-Token`, then with a wrong token, then set `ADMIN_TOKEN=secret` env and send with `X-Admin-Token: secret`.

**Expected:** First two requests return 401; third request returns 200 and calls `runner.refreshPrompts()`.

**Why human:** The implementation is straightforward but untested by any automated test in this phase. Authentication logic must be confirmed to work correctly in a live request context.

#### 3. WebhookHandler + BrainRunner Integration

**Test:** Create a `createWebhookApp(runner)` instance (with a mock runner satisfying IBrainRunnerLike), send `POST /api/v1/webhook` with a valid BrainEvent body and `X-Request-Id` header.

**Expected:** Response is `{ status: "ok", reply: "<runner mock response>" }` with 200 status. Existing transport tests cover the no-runner fallback path; this verifies the runner-injected path.

**Why human:** The runner-injected code path in handler.ts (lines 61-64) has not been covered by any automated test. The transport test suite (15 tests) tests webhook behavior without the runner parameter.

### Gaps Summary

No structural or implementation gaps were found. All 4 roadmap success criteria are met by substantive, wired, and data-flowing code. All 13 referenced commits exist. All 16 unit tests pass. All 4 requirement IDs (SDK-01, SDK-02, SDK-03, SDK-04) are covered by implementation evidence.

Three items require human verification: the end-to-end BrainRunner conversation flow with a real database, the /reload-prompts authentication behavior, and the WebhookHandler runner-injected path. These are integration testing gaps — the automated code is complete and correct, but has not been exercised in a live environment.

---

_Verified: 2026-06-12_
_Verifier: Claude (gsd-verifier)_
