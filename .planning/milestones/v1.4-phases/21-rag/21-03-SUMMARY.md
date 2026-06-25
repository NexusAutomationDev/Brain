---
phase: 21-rag
plan: "03"
subsystem: rag
tags: [rag, search_knowledge, tool-factory, barrel-export, brain-sdr, langgraph]
dependency_graph:
  requires:
    - 21-01  # D-17 createEmbeddings defaults, test stubs RED
    - 21-02  # chunker.ts, search.ts, ingest.ts, rag/index.ts GREEN
  provides:
    - createSearchKnowledgeTool (packages/core)
    - createIngestApp barrel export (packages/core)
    - brain-sdr RAG integration (server.ts + index.ts)
  affects:
    - apps/brain-sdr  # server mounts ingest, registry enables search_knowledge
    - packages/core   # public API barrel expanded with RAG exports
tech_stack:
  added: []
  patterns:
    - tool factory closure over sql (search-knowledge.ts — D-06)
    - resolveEmbeddingModel inlined to avoid mock interference
    - Zod min(1) guard on collections array (Pitfall 3 / T-21-03-01)
    - formatResults blocks [Coleção: X] chunk N/M (D-10)
key_files:
  created:
    - packages/core/src/tools/search-knowledge.ts
    - .planning/phases/21-rag/21-03-SUMMARY.md
  modified:
    - packages/core/src/index.ts
    - apps/brain-sdr/src/server.ts
    - apps/brain-sdr/src/index.ts
decisions:
  - "resolveEmbeddingModel duplicated inline in search-knowledge.ts (not imported from search.ts) to avoid Bun mock interference — mock.module replaces entire module including resolveEmbeddingModel, which would be undefined at runtime under test"
  - "node_modules symlinked from main repo to worktree for test execution — worktrees do not inherit pnpm install"
metrics:
  duration: "~68 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  files_changed: 4
  commits: 2
---

# Phase 21 Plan 03: search_knowledge Tool + brain-sdr RAG Integration Summary

createSearchKnowledgeTool factory with Zod validation, D-10 block formatting, D-11 no-throw empty result, plus barrel exports and brain-sdr server/registry integration — closes all 4 RAG requirements (RAG-01 to RAG-04).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Implement createSearchKnowledgeTool — RED→GREEN | `fbe92ec` | `packages/core/src/tools/search-knowledge.ts` |
| 2 | Barrel export + brain-sdr integration | `05c46e2` | `packages/core/src/index.ts`, `apps/brain-sdr/src/server.ts`, `apps/brain-sdr/src/index.ts` |

## What Was Built

### Task 1 — createSearchKnowledgeTool

`packages/core/src/tools/search-knowledge.ts` — factory following the exact `createPauseSessionTool` pattern:

- **Tool name:** `search_knowledge`
- **D-06:** Closure over `sql` — multi-tenant compatible
- **D-07/D-08/D-09:** topK=5 and threshold=0.5 hardcoded — LLM cannot configure
- **D-10:** Results formatted as `[Coleção: {collection}] chunk {chunkIndex+1}/{totalChunks}\n{content}` separated by `\n---\n`
- **D-11:** Empty result returns `"Nenhum resultado encontrado para a consulta nas coleções informadas."` without throwing
- **Pitfall 1:** Uses `embedder.embedQuery()` (not `embedDocuments`)
- **Pitfall 3 / T-21-03-01:** Zod schema enforces `collections.min(1)` + defensive guard

### Task 2 — Barrel Export + brain-sdr Integration

**`packages/core/src/index.ts`:** Added RAG block after SDK-07:
```typescript
export { createSearchKnowledgeTool } from "./tools/search-knowledge.js";
export { createIngestApp } from "./rag/index.js";
```

**`apps/brain-sdr/src/server.ts`:** Added ingest route:
```typescript
app.route("/", createIngestApp(sql)); // RAG-01/D-05
```

**`apps/brain-sdr/src/index.ts`:** Enabled search_knowledge in ToolsRegistry:
```typescript
toolsRegistry.enableTool("sdr", "search_knowledge"); // D-12/RAG-02
```

## Verification Results

```
search-knowledge.test.ts:  10/10 GREEN
rag/__tests__/:            27/27 GREEN  (no regression)
tools/__tests__/:          37/37 GREEN  (no regression)
typecheck (main repo):      0 errors
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug Prevention] resolveEmbeddingModel duplicated inline instead of imported from search.ts**

- **Found during:** Task 1 — analysis of test mock setup
- **Issue:** `mock.module("../../rag/search.js", ...)` in `search-knowledge.test.ts` replaces the entire module with only `{ searchKnowledge: mockSearchKnowledge }`. If `createSearchKnowledgeTool` imports `resolveEmbeddingModel` from `../rag/search.js`, it receives `undefined` at test runtime, causing `TypeError: undefined is not a function`.
- **Fix:** Duplicated the 8-line `resolveEmbeddingModel()` function inline in `search-knowledge.ts` with a comment explaining the reasoning. Follows the same logic as `search.ts` (same ENV vars, same defaults).
- **Files modified:** `packages/core/src/tools/search-knowledge.ts`
- **Commit:** `fbe92ec`

**2. [Rule 3 - Blocking] node_modules symlinks for worktree test execution**

- **Found during:** Task 1 verification
- **Issue:** Git worktrees do not inherit `pnpm install` — `node_modules` absent from worktree. `bun test` failed with `Cannot find module '@langchain/core/tools'`.
- **Fix:** Created symlinks from main repo `node_modules` to worktree packages (`packages/core`, `packages/ai`, `packages/database`, `packages/shared`, `packages/observability`, `apps/brain-sdr`, `apps/brain-echo`).
- **Note:** Symlinks are untracked (covered by `.gitignore node_modules/`) — not committed.
- **Commit:** n/a (runtime setup only)

## Known Stubs

None — all RAG flow is wired end-to-end:
- Ingest: `POST /api/v1/ingest` → chunker → embedding → pgvector insert
- Search: `search_knowledge(query, collections[])` → embedQuery → cosine search → formatted string

## Threat Flags

No new security surface beyond what is documented in the plan's threat model:
- T-21-03-01: Mitigated via Zod `min(1)` on collections + defensive guard
- T-21-03-02/03/04: Accepted as documented

## Self-Check: PASSED

Files exist:
- `packages/core/src/tools/search-knowledge.ts` — FOUND
- `packages/core/src/index.ts` (modified) — FOUND
- `apps/brain-sdr/src/server.ts` (modified) — FOUND
- `apps/brain-sdr/src/index.ts` (modified) — FOUND

Commits:
- `fbe92ec` — FOUND (feat: implement createSearchKnowledgeTool)
- `05c46e2` — FOUND (feat: barrel export + brain-sdr RAG integration)
