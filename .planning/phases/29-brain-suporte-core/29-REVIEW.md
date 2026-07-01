---
phase: 29-brain-suporte-core
reviewed: 2026-07-01T00:00:00Z
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
  info: 3
  total: 4
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-07-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11 (`pnpm-lock.yaml` excluded from findings — dependency lockfile, no logic to review)
**Status:** issues_found

## Summary

This review covers the full current state of `brain-support` after the 29-03 gap-closure plan, which added a `RESERVED_TOOL_NAMES` filter in `apps/brain-support/src/brain.ts` to prevent MCP tools from colliding with reserved native tool names (`search_knowledge`, `pause_session`, `finish_conversation`, `respond`) before `bindTools()`/`ToolNode`. This output replaces the prior `29-REVIEW.md`.

**Previously flagged WR-01 (search_knowledge collision with same-named MCP tool) is now fixed.** `safeMcpTools` filters `ctx.mcpTools` against `RESERVED_TOOL_NAMES` before concatenation with `nativeTools` (brain.ts:131-140), a warning is logged when a collision is dropped, and `boundSearchKnowledgeTool` is still appended by direct variable reference (not name lookup) after the `enabledTools` filter runs — so it can't be excluded via `BRAIN_TOOLS` or shadowed by a colliding MCP tool. `brain.test.ts` adds explicit regression tests for collisions on both `search_knowledge` and `pause_session`, asserting exactly one tool of each name reaches `bindTools()` and that the native tool's description (not the MCP tool's) wins. This closes the gap correctly.

One new residual Warning is raised below: the same "structurally required, never excludable" guarantee given to `search_knowledge` is not extended to the `respond` tool, even though `respond` is equally load-bearing (the graph cannot emit a normal response without it). This was true before 29-03 too (inherited from `brain-sdr`), but is being surfaced now because this review evaluates the full current file, and the fix pattern used for `search_knowledge` in this same phase makes the gap for `respond` more conspicuous by comparison. A few Info-level items round out the report. No Critical issues were found.

## Warnings

### WR-01: `respond` tool can be excluded via `BRAIN_TOOLS`, silently breaking the graph's only success-response path

**File:** `apps/brain-support/src/brain.ts:109-147`
**Issue:** `respondTool` (line 110) is included in `nativeTools` (lines 122-126), which is subject to the `ctx.enabledTools` (`BRAIN_TOOLS` whitelist) filter at lines 142-144 — exactly like `pause_session`, `finish_conversation`, and MCP tools. Unlike `search_knowledge`, which this phase deliberately hardened to bypass `BRAIN_TOOLS` filtering entirely (D-04, lines 117-121, 145-147), `respond` has no equivalent protection.

If an operator sets `BRAIN_TOOLS` to a value that omits `"respond"` (e.g. `BRAIN_TOOLS=pause_session,search_knowledge`, or simply a typo), the LLM is never bound the `respond` tool. Consequences:
- `routeAfterLlm` (line 159) can never route to `"respond"`, since `toolCalls[0].name === "respond"` will never match.
- `hasRespondCall` in the `llm` node (line 212) is always `false`.
- Every turn falls into the `PITFALL-6` fallback branch (lines 224-237), setting `responseMode: "undefined"` on every single response instead of only on genuine LLM misbehavior.

This degrades the entire user-facing response contract silently in production — there is no fail-fast validation that `respond` remains bound after filtering. The same structural pattern (`nativeTools` includes `respondTool`, filtered by `enabledTools`) exists in `brain-sdr`'s `brain.ts`, so this is an inherited risk, not something newly introduced by the 29-03 diff. It's flagged here because this review evaluates the complete current state of `brain.ts`, and the reasoning that justified excluding `search_knowledge` from the `BRAIN_TOOLS` filter in this very phase (D-04: "never disableable") applies with equal force to `respond` — arguably more so, since without `respond` the Brain cannot produce a normal answer at all, whereas without `search_knowledge` it can still answer (just without RAG context).

**Fix:** Extend the same "append after filter" treatment already used for `search_knowledge` to `respond`:
```ts
const nativeTools = [
  boundPauseSessionTool,
  boundFinishConversationTool,
];
const safeMcpTools = ctx.mcpTools.filter((t) => !RESERVED_TOOL_NAMES.has(t.name));
const allToolsExceptReserved = [...nativeTools, ...safeMcpTools];
const filteredExceptReserved = ctx.enabledTools
  ? allToolsExceptReserved.filter((t) => ctx.enabledTools!.has(t.name))
  : allToolsExceptReserved;
// D-04-style guarantee extended to respond: structurally required for the graph's
// only success-response path — must never be excludable via BRAIN_TOOLS.
const filteredAllTools = [...filteredExceptReserved, respondTool, boundSearchKnowledgeTool];
```
If broadening scope beyond phase 29 is undesirable, at minimum add a `buildGraph()`-time guard that throws (or logs at `error` level and refuses to start) when `ctx.enabledTools` is non-null and does not contain `"respond"`, so misconfiguration fails loudly rather than degrading every response silently. Consider filing this as a follow-up gap affecting both `brain-support` and `brain-sdr`.

## Info

### IN-01: `RESERVED_TOOL_NAMES` is a hardcoded literal, not derived from the actual tool instances it protects

**File:** `apps/brain-support/src/brain.ts:84-89`
**Issue:** `RESERVED_TOOL_NAMES` hardcodes four string literals (`"search_knowledge"`, `"pause_session"`, `"finish_conversation"`, `"respond"`). These must stay in sync with the `.name` fields of `boundPauseSessionTool`, `boundFinishConversationTool`, `respondTool`, and `boundSearchKnowledgeTool`, all produced by factory functions defined in `@brain-pkg/core` — outside this file's control. If a future refactor in `packages/core` renames one of those tools, this set goes stale silently (no compile-time or runtime check ties the two together), reopening the exact collision class this phase's fix closes, for the renamed tool specifically.
**Fix:** Derive the set at runtime from the actual tool instances instead of duplicating literals:
```ts
const nativeTools = [boundPauseSessionTool, boundFinishConversationTool, respondTool];
const RESERVED_TOOL_NAMES = new Set([...nativeTools.map((t) => t.name), boundSearchKnowledgeTool.name]);
```
This requires moving the `RESERVED_TOOL_NAMES` declaration below tool construction, but removes the duplication risk entirely. If the literal set is kept for readability, consider adding a dedicated unit test asserting `RESERVED_TOOL_NAMES` equals `nativeTools.map(t => t.name)` plus `search_knowledge`, so a future rename in `packages/core` fails the test suite instead of silently reopening the gap.

### IN-02: `getEmbeddingProvider()` module-level memoization is a process-lifetime singleton with no invalidation path

**File:** `apps/brain-support/src/brain.ts:28-34`
**Issue:** `embeddingProviderPromise` is a module-level singleton shared by every `LazyEmbeddingProvider` instance and every `buildGraph()` call within the process. This is intentional (per the existing D-02 Phase 28 comment) but means `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` are effectively frozen for the process lifetime. There is a `/reload-prompts` endpoint (`createCoreApp`) that hot-reloads prompts at runtime, but no equivalent for embedding config — if one is added later, it must remember to reset this singleton, and nothing in the code currently signals that dependency.
**Fix:** Add a one-line comment near the `embeddingProviderPromise` declaration noting that any future hot-reload feature touching `EMBEDDING_*` env vars must also reset this promise, to prevent a future maintainer from assuming `/reload-prompts`-style reloads already cover it.

### IN-03: Duplicate/inconsistent AI-message type-guard pattern between `routeAfterLlm`/`llm` node and `respond` node

**File:** `apps/brain-support/src/brain.ts:159-168, 260`
**Issue:** `routeAfterLlm` uses `"tool_calls" in lastMessage` as its guard, while the `respond` node's backward scan (line 260) uses `msg.getType?.() === "ai" || (msg as any)._getType?.() === "ai"` — checking two differently-named accessor methods defensively. This is inherited unchanged from `brain-sdr` (not introduced by the 29-03 diff), so it's Info-only, but worth tracking: if a future LangChain major version drops one of `getType`/`_getType`, both Brains break identically since the pattern is duplicated rather than centralized.
**Fix:** No action required this phase. Consider extracting a shared `isAIMessage(msg)` helper into `@brain-pkg/ai` used by all Brains, so the defensive check (and any future LangChain compatibility fix) lives in one place instead of being copy-pasted per Brain.

---

_Reviewed: 2026-07-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
