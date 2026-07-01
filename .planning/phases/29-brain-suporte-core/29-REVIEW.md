---
phase: 29-brain-suporte-core
reviewed: 2026-07-01T19:45:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/brain-support/.env.example
  - apps/brain-support/package.json
  - apps/brain-support/src/__tests__/unit/brain.test.ts
  - apps/brain-support/src/__tests__/unit/server.test.ts
  - apps/brain-support/src/__tests__/unit/toolsregistry-support.test.ts
  - apps/brain-support/src/brain.ts
  - apps/brain-support/src/index.ts
  - apps/brain-support/src/server.ts
  - apps/brain-support/tsconfig.json
  - packages/database/src/migrations/0010_brain_support_prompts.sql
  - packages/database/src/migrations/meta/_journal.json
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-07-01T19:45:00Z
**Depth:** standard
**Files Reviewed:** 11 (pnpm-lock.yaml excluded from findings — dependency lockfile, no logic to review)
**Status:** issues_found

## Summary

Reviewed the new `brain-support` app: entrypoint (`index.ts`), Hono server composition (`server.ts`), LangGraph implementation (`brain.ts`), the seed migration for the `system` prompt, and the accompanying unit tests. The app closely mirrors the proven `brain-sdr` implementation (same TenantPoolManager bootstrap, same Hono sub-app composition, same LangGraph ReAct pattern with `respond`/`tools` routing), which is intentional per the phase's design docs (D-01/D-02/D-04/D-06 in `29-CONTEXT.md`) and keeps risk low.

After `pnpm install`, all 15 unit tests pass (`bun test apps/brain-support/src/__tests__/unit`). No Dockerfile exists for `brain-support`, but this is explicitly deferred to Phase 30 per `29-CONTEXT.md` ("Fase 30 (Docker)... estão fora do escopo desta fase") and is not a defect of this phase.

One warning-level structural gap was found around the `search_knowledge` tool's "always-on" guarantee when combined with MCP tools of the same name. Two minor info-level items round out the review — both inherited unchanged from `brain-sdr` and not introduced by this phase, but worth tracking since this is a good opportunity to fix them once for both Brains.

## Warnings

### WR-01: `search_knowledge` "always enabled" guarantee can be defeated by a same-named MCP tool

**File:** `apps/brain-support/src/brain.ts:106-122`
**Issue:** D-04 states that `search_knowledge` "NUNCA pode ser filtrada por BRAIN_TOOLS" and is guaranteed to be present by appending `boundSearchKnowledgeTool` *after* the `ctx.enabledTools` filter runs. This holds for the `nativeTools` array, but `ctx.mcpTools` is concatenated into `allToolsExceptSearch` (line 116) *before* the append. If an operator configures an MCP server (`MCP_URL`) that exposes a tool literally named `search_knowledge`, that MCP-sourced tool instance survives the `enabledTools` filter (or is unfiltered when `enabledTools` is null) and is passed into `bindTools()` alongside the native `boundSearchKnowledgeTool` — producing **two distinct tool objects with the same name** in the same `bindTools()` call and in the `ToolNode`.

Depending on the LLM provider's schema serialization, this can silently shadow the RAG-backed `search_knowledge` tool with an MCP-provided one (undefined precedence), which breaks the explicit guarantee this code documents and tests (`toolsregistry-support.test.ts`, `brain.test.ts` "search_knowledge sempre ativa"). The current tests only check that a `search_knowledge` *name* is present in the `bindTools` call args, so this collision would not be caught.

**Fix:** Filter out any MCP tool that collides with the reserved native tool names before binding, e.g.:
```ts
const RESERVED_TOOL_NAMES = new Set(["search_knowledge", "pause_session", "finish_conversation", "respond"]);
const safeMcpTools = ctx.mcpTools.filter((t) => !RESERVED_TOOL_NAMES.has(t.name));
const allToolsExceptSearch = [...nativeTools, ...safeMcpTools];
```
Optionally log a warning when a collision is dropped, so misconfigured MCP servers are visible in operator logs. This same pattern should probably be backported to `brain-sdr` since it shares the identical `allTools = [...nativeTools, ...ctx.mcpTools]` construction (though in `brain-sdr`, `search_knowledge` is part of `nativeTools` and thus not subject to the append-after-filter concern in quite the same way, MCP collisions with `qualify_lead`/`pause_session`/etc. are still possible there too).

## Info

### IN-01: `EMBEDDING_DIMENSIONS` comment in `.env.example` references migration by number, will go stale

**File:** `apps/brain-support/.env.example:32-34`
**Issue:** The comment says "EMBEDDING_DIMENSIONS deve bater com a coluna vector(N) migrada no banco deste Brain (migration 0009)." Migration `0009_embedding_dimensions_fix.sql` is a shared migration (applies to the common `embeddings`/`knowledge_chunks` tables used by every Brain via `packages/database`), not something scoped or numbered specifically for `brain-support`. If a future migration changes the vector dimension again (e.g., `0011_*`), this comment will silently point to the wrong migration number, misleading whoever edits `EMBEDDING_DIMENSIONS` next.
**Fix:** Reference the table/column instead of a migration number, e.g.: "deve bater com a coluna `vector(N)` das tabelas `embeddings`/`knowledge_chunks` (ver packages/database/src/migrations para a migration mais recente que alterou essa dimensão)." This avoids the comment drifting out of sync with the migration history.

### IN-02: Duplicate `respond` tool-call lookup loop uses loose type guards inconsistently

**File:** `apps/brain-support/src/brain.ts:232-240`
**Issue:** The lookup for the last AI message uses `msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai"` — two different method names (`getType` vs `_getType`) checked with optional chaining, while `routeAfterLlm` (line 136) and the `llm` node (line 172) elsewhere in the same file consistently use `_getType()` without the `getType()` variant. This isn't a functional bug (LangChain messages implement `_getType()`), but the inconsistency suggests defensive coding added ad hoc rather than a deliberate contract, and makes it unclear whether `getType()` is ever expected to be the only method present on some message variant. This is inherited unchanged from `brain-sdr` and not introduced by this phase.
**Fix:** Standardize on the same type-check helper used elsewhere in the file (`_getType()`), or if both are genuinely needed for compatibility with different message class versions, add a one-line comment explaining why two different accessor names are checked.

---

_Reviewed: 2026-07-01T19:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
