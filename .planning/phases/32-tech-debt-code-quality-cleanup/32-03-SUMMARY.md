---
phase: 32-tech-debt-code-quality-cleanup
plan: 03
subsystem: api
tags: [langgraph, typescript, brain-sdr, brain-support, type-guards, code-quality]

# Dependency graph
requires:
  - phase: 29-brain-suporte-core
    provides: brain-support's brain.ts with RESERVED_TOOL_NAMES literal and duplicated routeAfterLlm logic
  - phase: 31-tech-debt-onboarding-hardening
    provides: brain-sdr's RESERVED_TOOL_NAMES literal + WR-01/TECH-05 collision-drop fix
provides:
  - "hasToolCall()/getFirstToolCallName() shared type-guards in @brain-pkg/core"
  - "RESERVED_TOOL_NAMES derived from real tool instances in both brain-sdr and brain-support"
  - "Inline rationale documentation for LazyEmbeddingProvider and getEmbeddingProvider()"
affects: [brain-echo, future-brains, packages/core]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared duck-typed AI-message type-guards in packages/core/src/brain/type-guards.ts, exported from @brain-pkg/core barrel"
    - "RESERVED_TOOL_NAMES computed inside buildGraph() from actual tool instances via .map((t) => t.name), not a hardcoded Set literal"

key-files:
  created:
    - packages/core/src/brain/type-guards.ts
    - packages/core/src/brain/__tests__/type-guards.test.ts
  modified:
    - packages/core/src/index.ts
    - apps/brain-sdr/src/brain.ts
    - apps/brain-support/src/brain.ts
    - apps/brain-sdr/src/__tests__/unit/brain.test.ts
    - apps/brain-support/src/__tests__/unit/brain.test.ts

key-decisions:
  - "hasToolCall/getFirstToolCallName live in packages/core (runtime helpers), not packages/shared (pure types only)"
  - "RESERVED_TOOL_NAMES Set is explicitly typed <string> to avoid TypeScript narrowing to a literal union from the derived tool-name array, keeping .has(t.name) comparisons against ctx.mcpTools/enabledTools type-compatible"
  - "respond node's tool_calls.find() scan loop intentionally left untouched — different operation (find full call object vs. name-only check), out of this refactor's scope per plan"

requirements-completed: [TECH-06]

# Metrics
duration: 11min
completed: 2026-07-02
---

# Phase 32 Plan 03: Shared Type-Guards + Derived RESERVED_TOOL_NAMES Summary

**Extracted duplicated `tool_calls` inspection logic from brain-sdr/brain-support into `hasToolCall()`/`getFirstToolCallName()` in `@brain-pkg/core`, and replaced both Brains' hardcoded `RESERVED_TOOL_NAMES` literals with a derivation from the actual native tool instances built in `buildGraph()`.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-01T22:51:54-03:00
- **Completed:** 2026-07-01T22:58:01-03:00
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Closed IN-03 (29-REVIEW): `routeAfterLlm` and the respond-detection logic in both `brain-sdr` and `brain-support` now call the same `hasToolCall`/`getFirstToolCallName` helpers instead of duplicating the inline `!("tool_calls" in lastMessage)` check independently in two files
- Closed IN-01 (29-REVIEW): `RESERVED_TOOL_NAMES` in both Brains is now derived from the real `boundQualifyTool`/`boundPauseSessionTool`/`boundFinishConversationTool`/`boundSearchKnowledgeTool`/`respondTool` instances constructed in `buildGraph()`, eliminating the staleness risk of a hand-maintained literal
- Documented (without changing behavior) `LazyEmbeddingProvider`'s placeholder `dimensions:0`/`providerName:"unresolved"` values (D-04) and `getEmbeddingProvider()`'s process-lifetime singleton rationale (D-05/D-10) inline in both files

## Task Commits

Each task was committed atomically (TDD: test → feat, plus one refactor commit for Task 2):

1. **Task 1 RED: add failing test for hasToolCall type-guard** - `78312e8` (test)
2. **Task 1 GREEN: implement shared hasToolCall type-guard** - `ff7c17b` (feat)
3. **Task 2 test coverage: RESERVED_TOOL_NAMES full-set coverage** - `743e4c0` (test)
4. **Task 2 refactor: derive RESERVED_TOOL_NAMES + document embedding rationale** - `7972800` (refactor)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/core/src/brain/type-guards.ts` - `hasToolCall(message, toolName)` and `getFirstToolCallName(message)` duck-typed helpers, safe against undefined/malformed messages
- `packages/core/src/brain/__tests__/type-guards.test.ts` - 8 unit tests covering both helpers' edge cases
- `packages/core/src/index.ts` - Exports `hasToolCall`, `getFirstToolCallName` from the public barrel
- `apps/brain-sdr/src/brain.ts` - `routeAfterLlm` and respond-detection use shared type-guards; `RESERVED_TOOL_NAMES` derived from tool instances inside `buildGraph()`; `LazyEmbeddingProvider`/`getEmbeddingProvider()` documented
- `apps/brain-support/src/brain.ts` - Same changes as brain-sdr, independently applied
- `apps/brain-sdr/src/__tests__/unit/brain.test.ts` - Added MCP collision test for `qualify_lead` and full reserved-name-set completeness test
- `apps/brain-support/src/__tests__/unit/brain.test.ts` - Added full reserved-name-set completeness test

## Decisions Made
- `hasToolCall`/`getFirstToolCallName` placed in `packages/core` (runtime logic), not `packages/shared` (pure types/duck-typed interfaces only), per CONTEXT.md's package boundary convention
- `RESERVED_TOOL_NAMES` explicitly typed as `Set<string>` rather than letting TypeScript infer a narrow literal union from the mapped tool-name array — this was required for `.has(t.name)` comparisons against `ctx.mcpTools`/`ctx.enabledTools` (both typed as plain `string`) to typecheck
- The `respond` node's `tool_calls.find((c) => c.name === "respond")` scan loop was deliberately left unchanged — it returns a full call object (for `.args`), a different operation from the presence/name-only checks the shared helpers replace; refactoring it was explicitly out of scope per the plan

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `RESERVED_TOOL_NAMES` needed explicit `Set<string>` typing**
- **Found during:** Task 2 (verification via `pnpm --filter @brain-app/support typecheck` after rebuilding `packages/core`)
- **Issue:** `new Set([...].map((t) => t.name))` let TypeScript infer a narrow literal union (e.g. `"search_knowledge" | "pause_session" | "finish_conversation" | "respond"`) from the native tool factories' typed `name` properties. `RESERVED_TOOL_NAMES.has(t.name)` then failed to typecheck against `ctx.mcpTools`' `t.name: string` (TS2345: `Argument of type 'string' is not assignable to parameter of type '"search_knowledge" | ...'`)
- **Fix:** Added explicit `new Set<string>(...)` type parameter in both `brain-sdr/src/brain.ts` and `brain-support/src/brain.ts`
- **Files modified:** `apps/brain-sdr/src/brain.ts`, `apps/brain-support/src/brain.ts`
- **Verification:** `pnpm --filter @brain-app/sdr typecheck` and `pnpm --filter @brain-app/support typecheck` both exit 0 after the fix
- **Committed in:** `7972800` (Task 2 commit)

**2. [Rule 3 - Blocking] Missing `node_modules` and stale build artifacts blocked verification**
- **Found during:** Start of Task 1 verification
- **Issue:** Worktree had no `node_modules` installed (`bun test` failed with `Cannot find module '@langchain/core/messages'`), and `packages/*/dist` were stale/missing, causing spurious TS6305 "output file not built from source" errors and masking the real TS2345 error above during typecheck
- **Fix:** Ran `bun install` to install dependencies, then `pnpm turbo run build` to rebuild all workspace packages in dependency order (resolved via Turborepo's task graph)
- **Files modified:** none (environment setup only; `bun.lock`/`pnpm-lock.yaml` unaffected beyond the pre-existing lockfile migration message)
- **Verification:** `bun test` and `pnpm --filter ... typecheck` run cleanly afterward
- **Committed in:** N/A (environment setup, not committed — `node_modules`/`dist` are gitignored)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes were necessary to get the plan's own verification commands to a passing state; no scope creep beyond what Task 2 already specified (typecheck was an explicit acceptance criterion).

## Issues Encountered
- Worktree branch base was stale (`f5c7a28` instead of `c2a2dd7`) at agent start — resolved via `git reset --soft` + `git checkout -- .planning/` to align working tree with the correct base commit before starting task work.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `hasToolCall`/`getFirstToolCallName` are now available in `@brain-pkg/core` for any future Brain (e.g. Customer Success) to reuse instead of reimplementing tool-call inspection
- `RESERVED_TOOL_NAMES` derivation pattern is established — a template for brain-echo or future Brains adding native tools without a parallel literal to maintain
- No blockers for the next plan in this phase

---
*Phase: 32-tech-debt-code-quality-cleanup*
*Completed: 2026-07-02*

## Self-Check: PASSED

All created/modified files verified present on disk; all 4 task commit hashes (`78312e8`, `ff7c17b`, `743e4c0`, `7972800`) verified in git log.
