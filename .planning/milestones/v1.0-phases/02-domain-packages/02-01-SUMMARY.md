---
phase: 02-domain-packages
plan: "01"
subsystem: monorepo-packages
tags: [scaffold, packages, ai, memory, transport, tsconfig, pnpm]
dependency_graph:
  requires: [02-00]
  provides: [packages/ai, packages/memory, packages/transport, tsconfig-paths]
  affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07]
tech_stack:
  added:
    - "@langchain/langgraph@1.4.1"
    - "@langchain/core@1.1.48"
    - "@langchain/langgraph-checkpoint-postgres@1.0.3"
    - "@langchain/openai@1.4.7"
    - "@langchain/anthropic@1.4.0"
    - "@langchain/google-genai@2.1.31"
    - "hono@4.12.25"
    - "zod@3.25.76"
  patterns:
    - "Workspace package with src/index.ts placeholder for phased implementation"
    - "tsconfig.base.json path alias per package"
key_files:
  created:
    - packages/ai/package.json
    - packages/ai/tsconfig.json
    - packages/ai/src/index.ts
    - packages/memory/package.json
    - packages/memory/tsconfig.json
    - packages/memory/src/index.ts
    - packages/transport/package.json
    - packages/transport/tsconfig.json
    - packages/transport/src/index.ts
  modified:
    - tsconfig.base.json
    - pnpm-lock.yaml
decisions:
  - "LangGraph deps pinned to ^1.4.1 (GA stable) per RESEARCH.md"
  - "zod added to transport for BrainEvent input validation (ASVS V5)"
  - "src/index.ts placeholder pattern: keeps package valid without implementation"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-11"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 2
---

# Phase 2 Plan 01: Monorepo Package Scaffold Summary

**One-liner:** Three new workspace packages registered (ai, memory, transport) with LangGraph/LangChain deps, Hono, Zod, and tsconfig path aliases — enabling all Wave 2 implementation plans to resolve @brain-pkg/* imports.

## What Was Built

Three new pnpm workspace packages were scaffolded as part of Wave 1 setup:

- **@brain-pkg/ai** — LangGraph/LangChain orchestration package. Declares all LangChain deps (langgraph@1.4.1, checkpoint-postgres@1.0.3, openai, anthropic, google-genai). Depends on @brain-pkg/shared.
- **@brain-pkg/memory** — Memory abstraction layer. Depends on @brain-pkg/shared, @brain-pkg/database, and @brain-pkg/ai as workspace links.
- **@brain-pkg/transport** — HTTP transport layer. Declares hono@4.12.25 and zod@3.23.8. Depends on @brain-pkg/shared.

Each package follows the existing pattern from packages/database:
- `package.json` with build/test/typecheck scripts
- `tsconfig.json` extending `../../tsconfig.base.json`
- `src/index.ts` placeholder (real exports added in Wave 2 implementation plans)

`tsconfig.base.json` was updated to add path aliases for all three packages, bringing the total to 6 `@brain-pkg/*` aliases.

`pnpm install` was run successfully (exit 0), installing 190 new packages including @langchain/langgraph@1.4.1 and the full LangChain ecosystem.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create packages/ai scaffold | d750895 | packages/ai/{package.json,tsconfig.json,src/index.ts} |
| 2 | Create packages/memory and packages/transport scaffolds | d100524 | packages/memory/*, packages/transport/* |
| 3 | Update tsconfig.base.json paths, run pnpm install | be51439 | tsconfig.base.json, pnpm-lock.yaml |

## Verification Results

```
@brain-pkg/ai@0.0.0 — @langchain/langgraph@1.4.1, @langchain/langgraph-checkpoint-postgres@1.0.3 installed
@brain-pkg/memory@0.0.0 — @brain-pkg/ai@link:../ai, @brain-pkg/database@link:../database linked
@brain-pkg/transport@0.0.0 — hono@4.12.25, zod@3.25.76 installed
tsconfig.base.json — @brain-pkg/ai, @brain-pkg/memory, @brain-pkg/transport paths confirmed
pnpm install exit code: 0
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| packages/ai/src/index.ts | `export {};` | Placeholder — real exports added in 02-02 (LangGraph types) and 02-03 (agent factory) |
| packages/memory/src/index.ts | `export {};` | Placeholder — real exports added in 02-04 (memory service) and 02-05 (embeddings) |
| packages/transport/src/index.ts | `export {};` | Placeholder — real exports added in 02-04 (webhook transport) |

These stubs are intentional — Wave 1 goal is workspace registration only. Implementation plans 02-02 through 02-07 will populate each package's exports.

## Threat Flags

None — this plan only declares package metadata and dependencies. No network endpoints, auth paths, or DB schema changes introduced.

## Self-Check: PASSED

All 9 created files exist on disk. All 3 task commits verified in git log.
