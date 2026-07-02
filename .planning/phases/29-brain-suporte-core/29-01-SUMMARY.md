---
phase: 29-brain-suporte-core
plan: 01
requirements-completed: [SUP-01, SUP-03, SUP-04, SUP-05, SUP-07]
subsystem: brain-support
tags: [brain-support, ibrain, react-graph, rag, tools-registry]
dependency-graph:
  requires:
    - packages/core (IBrain, BrainBuildContext, ToolsRegistry, createPauseSessionTool, createFinishConversationTool, createRespondTool, createSearchKnowledgeTool)
    - packages/embeddings (createEmbeddingProvider)
    - packages/transport (createTransport)
    - packages/database (TenantPoolManager)
    - packages/observability (createLogger, createHealthApp)
  provides:
    - apps/brain-support (@brain-app/support) — new workspace app, second real Brain
    - supportBrain IBrain implementation (brainType "support")
  affects:
    - Phase 30 (Brain Suporte Docker) will package this app
tech-stack:
  added: []
  patterns:
    - "search_knowledge appended after enabledTools filter runs (D-04 bypass), not name-based"
    - "pause_session/finish_conversation as native closures, no MCP dynamic loading (D-01/D-02)"
key-files:
  created:
    - apps/brain-support/package.json
    - apps/brain-support/tsconfig.json
    - apps/brain-support/src/brain.ts
    - apps/brain-support/src/index.ts
    - apps/brain-support/src/server.ts
    - apps/brain-support/src/__tests__/unit/brain.test.ts
  modified:
    - pnpm-lock.yaml
decisions:
  - "search_knowledge bypasses BRAIN_TOOLS filter by direct variable reference (filteredExceptSearch + append), never by name lookup — closes T-29-01 spoofing risk"
  - "No qualifier.ts equivalent — Brain Suporte has no sub-agent, promptKeys is only ['system']"
metrics:
  duration: "~45 minutes"
  completed: 2026-07-01
---

# Phase 29 Plan 01: Brain Suporte Core Scaffold Summary

Created `apps/brain-support` as a new workspace app (`@brain-app/support`) implementing `IBrain` for `brainType: "support"` — a ReAct graph with `pause_session`, `finish_conversation` (native closures) and `search_knowledge` (structurally always-on regardless of `BRAIN_TOOLS`), replicating the proven `brain-sdr` architecture with zero new infrastructure risk.

## What Was Built

**Task 1 — `apps/brain-support` scaffold + `supportBrain` (brain.ts):**
- `package.json` (`@brain-app/support`) and `tsconfig.json` copied verbatim from `brain-sdr`, same dependencies, scripts, and project references.
- `supportBrain: IBrain` with `id: "brain-support"`, `brainType: "support"`, `promptKeys: ["system"]` (no `"qualification"` — D-06, no sub-agent for Brain Suporte).
- `supportBrain.tools` has exactly 1 entry: the declarative `search_knowledge` schema (no `qualify_lead` equivalent).
- `buildGraph(ctx)` implements the D-04 bypass: `nativeTools` (`pause_session`, `finish_conversation`, `respond`) is filtered by `ctx.enabledTools`, then `boundSearchKnowledgeTool` is appended by direct variable reference AFTER the filter runs — `search_knowledge` can never be excluded via `BRAIN_TOOLS`.
- 7 unit tests covering IBrain contract, the D-04 bypass (both with an explicit whitelist excluding `search_knowledge` and with `enabledTools: null`), and the D-10 fallback (`responseMode: "undefined"` when the LLM emits no tool call) — proving `BrainOutput` contract parity with `brain-sdr` (SUP-05).

**Task 2 — Entrypoint (`index.ts`) and Hono server (`server.ts`):**
- `index.ts`: validates required `DATABASE_*` ENVs (fail-fast `process.exit(1)`, never logs `DATABASE_PASSWORD`), boots `TenantPoolManager`, registers `"support"` in `ToolsRegistry` with exactly 3 tools (`pause_session`, `finish_conversation`, `search_knowledge` — no qualify equivalent), initializes `BrainRunner` with `supportBrain`, creates `transport` and `embeddingProvider`, starts the Hono server via `Bun.serve()`.
- `server.ts`: copied verbatim from `brain-sdr` — mounts `health`, `webhook`, `core` (reload-prompts), and conditionally `ingest`/`reembed` sub-apps. Zero Brain-specific branching (Brain-agnostic by design).

## Verification

All 4 verification commands from the plan passed:
1. `bun test apps/brain-support/src/__tests__/unit/brain.test.ts` — 7 pass, 0 fail, 17 assertions.
2. `pnpm --filter @brain-app/support typecheck` — exits 0, no TS errors.
3. `grep -n "qualify_lead" apps/brain-support/src/*.ts` — no matches.
4. `grep -n "boundSearchKnowledgeTool" apps/brain-support/src/brain.ts` — confirms fixed-closure append pattern after `filteredExceptSearch`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Stale/missing package build artifacts caused TS6305 errors**
- **Found during:** Task 2 verification (`pnpm --filter @brain-app/support typecheck`)
- **Issue:** `tsc --noEmit` failed with `TS6305: Output file '.../dist/index.d.ts' has not been built from source file` for `packages/ai`, `packages/core`, `packages/embeddings`, `packages/observability`, `packages/transport`, `packages/database` — a pre-existing environment state (confirmed identical errors on `pnpm --filter @brain-app/sdr typecheck` before the fix, unrelated to this plan's code).
- **Fix:** Ran `pnpm --filter @brain-pkg/ai --filter @brain-pkg/core ... build` to regenerate `dist/*.d.ts` for all referenced packages. No source code was changed by this fix.
- **Files modified:** none (build artifacts only, gitignored).
- **Commit:** N/A (no tracked files changed).

### Comment-only adjustments (not deviations)

While verifying acceptance criteria, initial draft comments in `brain.ts` and `index.ts` referenced the literal string `qualify_lead` when explaining its absence (e.g. "sem qualify_lead"). Reworded to "sem tool de qualificação de lead" to strictly satisfy the acceptance criterion "does NOT contain the string `qualify_lead`" — no functional change.

## Known Stubs

None — all tool bindings (`pause_session`, `finish_conversation`, `search_knowledge`, `respond`) are real closures over `ctx.sql`/`ctx.llm`, no placeholder data paths.

## Threat Flags

None — this plan follows the threat model already defined in `29-01-PLAN.md` (T-29-01 through T-29-05), all dispositions (`mitigate`/`accept`) already addressed by the implementation as specified. No new trust boundaries or surfaces introduced beyond what was modeled.

## Self-Check: PASSED

- FOUND: apps/brain-support/package.json
- FOUND: apps/brain-support/tsconfig.json
- FOUND: apps/brain-support/src/brain.ts
- FOUND: apps/brain-support/src/index.ts
- FOUND: apps/brain-support/src/server.ts
- FOUND: apps/brain-support/src/__tests__/unit/brain.test.ts
- FOUND: commit 11a1306 (scaffold app and supportBrain graph)
- FOUND: commit ce9ce69 (entrypoint and Hono server)
