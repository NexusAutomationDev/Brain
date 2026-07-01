---
phase: 29-brain-suporte-core
plan: 03
subsystem: agent-graph
tags: [langgraph, mcp, security, brain-support, tool-collision]

# Dependency graph
requires:
  - phase: 29-brain-suporte-core (plan 01)
    provides: brain-support buildGraph() with search_knowledge always-on guarantee against BRAIN_TOOLS (D-04)
provides:
  - RESERVED_TOOL_NAMES set filtering ctx.mcpTools before concatenation in buildGraph()
  - Regression tests proving MCP tools named search_knowledge/pause_session cannot shadow native tools
affects: [brain-sdr (same allTools = [...nativeTools, ...ctx.mcpTools] pattern, same gap not yet fixed there)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Filter operator-controlled MCP tool list against a reserved native tool name set before any concatenation/bindTools() call"]

key-files:
  created: []
  modified:
    - apps/brain-support/src/brain.ts
    - apps/brain-support/src/__tests__/unit/brain.test.ts

key-decisions:
  - "RESERVED_TOOL_NAMES covers all 4 tools with structural guarantees (search_knowledge, pause_session, finish_conversation, respond), not just search_knowledge — any of them could be shadowed by a same-named MCP tool"
  - "Collision is dropped silently from the tool list but logged via logger.warn with only the tool name (no MCP server details/credentials) to avoid information disclosure while keeping the drop observable"

patterns-established:
  - "Reserved native tool names must be filtered out of any externally-configurable tool source (MCP, future dynamic tool sources) before concatenation into the list passed to bindTools()/ToolNode"

requirements-completed: [SUP-02]

# Metrics
duration: 15min
completed: 2026-07-01
---

# Phase 29 Plan 03: MCP Tool Collision Gap Closure Summary

**Filtered `ctx.mcpTools` against a `RESERVED_TOOL_NAMES` set in `brain-support`'s `buildGraph()` so an MCP server exposing a tool named `search_knowledge` (or `pause_session`/`finish_conversation`/`respond`) can no longer shadow the native tool with undefined `bindTools()` precedence.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-01T17:20:00-03:00 (approx)
- **Completed:** 2026-07-01T17:36:22-03:00
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Closed the SUP-02/D-04 gap identified in `29-VERIFICATION.md` and corroborated by `29-REVIEW.md` WR-01: `ctx.mcpTools` is now filtered against `RESERVED_TOOL_NAMES` (`search_knowledge`, `pause_session`, `finish_conversation`, `respond`) before being concatenated into the tool list bound to the LLM
- Added two regression tests proving that MCP tools named `search_knowledge` and `pause_session` are dropped without creating duplicate-name entries in `bindTools()` call args (tool count stays at 4, not 5, and the surviving tool is the native one, distinguished by its description)
- Verified the fix does not affect the pre-existing `BRAIN_TOOLS` (`ctx.enabledTools`) bypass guarantee for `search_knowledge` — all 7 original tests plus 2 new tests pass (9 total)

## Task Commits

Each task was committed atomically:

1. **Task 1: Filter ctx.mcpTools against reserved native tool names before concatenation, add regression test** - `c538bff` (security)

## Files Created/Modified
- `apps/brain-support/src/brain.ts` - Added `RESERVED_TOOL_NAMES` constant and `safeMcpTools` filter (with `logger.warn` on collision drop) applied before `ctx.mcpTools` is concatenated into `allToolsExceptSearch`
- `apps/brain-support/src/__tests__/unit/brain.test.ts` - Added `describe("BrainSupport — MCP tool colidindo com nome reservado é descartada (WR-01, SUP-02)")` with two tests using real `tool()`-constructed mock MCP tools named `search_knowledge` and `pause_session`

## Decisions Made
- Followed the plan's exact implementation pattern (filter-then-concatenate, `logger.warn` with tool name only) — no deviation from the suggested fix in `29-REVIEW.md` WR-01
- Confirmed via grep that `ctx.mcpTools` is referenced only inside the `safeMcpTools` filter definition, not directly in the `allToolsExceptSearch` array spread — matches the plan's acceptance criteria exactly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- This worktree's branch had been created from an older base commit that predated `29-03-PLAN.md` being committed to `master`. Rebased the worktree branch onto the correct target commit (`f3489689f703eeebc8069128b10119d1343c123c`) before starting work — a clean fast-forward, no conflicts.
- The worktree had no `node_modules` and no built `dist/` output for workspace packages, causing `pnpm --filter @brain-app/support typecheck` to fail with `TS6305` errors unrelated to this change. Ran `pnpm install` and `pnpm run build` (full monorepo build via turbo) to establish a clean baseline; typecheck then passed with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SUP-02's "search_knowledge can never be disabled or shadowed" guarantee now holds against both `BRAIN_TOOLS` (Plan 01) and `MCP_URL`-sourced name collisions (this plan)
- The same `allTools = [...nativeTools, ...ctx.mcpTools]` pattern exists unmodified in `brain-sdr` — noted in `29-REVIEW.md` WR-01 as a candidate for the same backport, but out of scope for this phase/plan (brain-sdr not touched)
- No Dockerfile or Docker-related work introduced — correctly deferred to Phase 30
- Phase 29 (Brain Suporte Core) plans 01-03 are now complete; ready for phase-level verification/closure

---
*Phase: 29-brain-suporte-core*
*Completed: 2026-07-01*
