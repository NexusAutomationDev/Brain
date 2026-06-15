---
phase: 11-tool-contracts-sdk
reviewed: 2026-06-15T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - packages/core/src/tools/__tests__/pause-session.test.ts
  - packages/core/src/tools/__tests__/finish-conversation.test.ts
  - packages/core/src/brain/interface.ts
  - packages/core/src/tools/registry.ts
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/tools/__tests__/tools-registry.test.ts
  - packages/core/src/leads/__tests__/lead-service.test.ts
  - packages/core/src/tools/pause-session.ts
  - packages/core/src/tools/finish-conversation.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/index.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-15
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This phase delivers the tool contracts SDK: the `pause_session` and `finish_conversation` tool factories, `ToolsRegistry` with BRAIN_TOOLS env-based whitelist, `LeadService` with `setFullpp`/`setIaAtivada`, the updated `BrainRunner`, and `IBrain` interface updates. The architecture is sound — thread_id from RunnableConfig, atomic DB updates, factory pattern for multi-tenant sql binding. The two tool implementations and the LeadService are clean. Three logic-level warnings and three info-level items were found.

---

## Warnings

### WR-01: BRAIN_TOOLS filtering all tools for a brainType causes ConfigurationError instead of returning []

**File:** `packages/core/src/tools/registry.ts:35-47`

**Issue:** When `BRAIN_TOOLS` is set to a value that matches none of the tools registered for a given `brainType`, every `enableTool()` call returns early before the `if (!this.registry.has(brainType))` branch executes. The `brainType` key is never inserted into the Map. A subsequent `getTools()` call finds no entry and throws `ConfigurationError("brainType not registered in ToolsRegistry")`. This is a misconfiguration-triggered runtime crash at startup, not the silent empty-list the env var is intended to produce.

Concrete scenario: `BRAIN_TOOLS=qualify_lead` and a Brain that only calls `enableTool("sdr", "pause_session")` and `enableTool("sdr", "finish_conversation")`. Both calls return early; `"sdr"` is never registered; `_compileGraph()` crashes.

**Fix:** Register the `brainType` entry regardless of whether the tool passes the env whitelist:

```typescript
enableTool(brainType: string, toolName: string): void {
  // Always ensure the brainType is registered, even if this specific tool is filtered.
  if (!this.registry.has(brainType)) {
    this.registry.set(brainType, new Set());
  }

  // D-07/D-08/D-09: BRAIN_TOOLS whitelist — ausente = sem filtro
  const envWhitelist = process.env.BRAIN_TOOLS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);  // also handles BRAIN_TOOLS="" edge case (see WR-02)
  if (envWhitelist !== undefined && !envWhitelist.includes(toolName)) {
    return; // silently ignored
  }

  this.registry.get(brainType)!.add(toolName);
}
```

---

### WR-02: `BRAIN_TOOLS=""` (empty string) silently blocks all tools

**File:** `packages/core/src/tools/registry.ts:37-41`

**Issue:** If `BRAIN_TOOLS` is set to an empty string (e.g., via a misconfigured Docker ENV directive), `process.env.BRAIN_TOOLS?.split(",").map(s => s.trim())` produces `[""]`. Since no tool name is the empty string, `!envWhitelist.includes(toolName)` is always true and every `enableTool()` call returns early. All tools are silently suppressed. Combined with WR-01, this also means no `brainType` is ever registered, so `getTools()` throws at startup. With WR-01 fixed, the brainType at least registers but all tools are filtered — the Brain runs with zero tools, which is a subtler failure mode.

**Fix:** Filter out empty strings after trimming:

```typescript
const envWhitelist = process.env.BRAIN_TOOLS
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean); // removes "" from [""]
if (envWhitelist !== undefined && envWhitelist.length > 0 && !envWhitelist.includes(toolName)) {
  return;
}
```

The `envWhitelist.length > 0` guard also ensures `BRAIN_TOOLS=""` is treated as "unset" (all tools allowed), consistent with the documented behavior (TOOLS-ENV-02).

---

### WR-03: `BRAIN_TOOLS` env var re-read on every `enableTool()` call — inconsistency risk

**File:** `packages/core/src/tools/registry.ts:37-41`

**Issue:** `process.env.BRAIN_TOOLS` is read inside `enableTool()`, which is called once per tool during startup. In normal single-process operation this is harmless. However, the current design means the whitelist is evaluated at registration time rather than at lookup time. If any code path (test setup, dynamic config reload) mutates `BRAIN_TOOLS` between `enableTool()` calls within the same startup sequence, some tools see one whitelist and others see a different one. This is already causing friction in the test suite: `beforeEach`/`afterEach` in `tools-registry.test.ts` must carefully restore `process.env.BRAIN_TOOLS` because it affects construction-time behavior.

Reading the env var once at class construction (or at `getTools()` time) would be more predictable:

```typescript
export class ToolsRegistry {
  private readonly envWhitelist: Set<string> | null;

  constructor() {
    const raw = process.env.BRAIN_TOOLS;
    if (raw !== undefined) {
      const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
      this.envWhitelist = parsed.length > 0 ? new Set(parsed) : null;
    } else {
      this.envWhitelist = null;
    }
  }

  enableTool(brainType: string, toolName: string): void {
    if (!this.registry.has(brainType)) {
      this.registry.set(brainType, new Set());
    }
    if (this.envWhitelist !== null && !this.envWhitelist.has(toolName)) {
      return;
    }
    this.registry.get(brainType)!.add(toolName);
  }
  // ...
}
```

---

## Info

### IN-01: Missing test coverage — BRAIN_TOOLS filtering all tools for a brainType

**File:** `packages/core/src/tools/__tests__/tools-registry.test.ts:57-114`

**Issue:** The existing BRAIN_TOOLS tests (lines 73-113) always include at least one tool that passes the whitelist, so the `brainType` entry is always created. The scenario described in WR-01 — where BRAIN_TOOLS contains none of the tools registered for a given brainType — is not tested. If WR-01 is fixed, a test should assert that `getTools()` returns `[]` rather than throwing when BRAIN_TOOLS filters all tools.

**Fix:** Add a test:

```typescript
test("getTools() retorna [] quando BRAIN_TOOLS filtra todos os tools do brainType (WR-01)", () => {
  process.env.BRAIN_TOOLS = "toolC"; // nem toolA nem toolB
  const registry = new ToolsRegistry();
  const toolA = makeTool("toolA");
  const toolB = makeTool("toolB");
  registry.enableTool("echo", "toolA");
  registry.enableTool("echo", "toolB");
  // Deve retornar [] e NÃO lançar ConfigurationError
  expect(() => registry.getTools("echo", [toolA, toolB])).not.toThrow();
  expect(registry.getTools("echo", [toolA, toolB])).toEqual([]);
});
```

---

### IN-02: `BrainOutput` and `ResponseMode` re-exported via two hops in `index.ts`

**File:** `packages/core/src/index.ts:27`

**Issue:** `index.ts` re-exports `BrainOutput` and `ResponseMode` from `./output/schema.js`, which itself re-exports them from `@brain-pkg/shared`. This creates a two-hop re-export chain. While TypeScript resolves it correctly and it is not a bug, consumers importing from `@brain-pkg/core` receive types that originated in `@brain-pkg/shared`. If the types in `shared` ever change and `schema.ts`'s re-export is not updated, the barrel export silently becomes stale. A brief comment acknowledging this chain would prevent future confusion.

**Fix:** Add a comment to `index.ts`:

```typescript
// SDK-06: BrainOutput and ResponseMode are defined in @brain-pkg/shared and
// re-exported through ./output/schema.ts to keep consumers on a single import path.
export { BrainOutputSchema, ResponseModeSchema } from "./output/schema.js";
export type { BrainOutput, ResponseMode } from "./output/schema.js";
```

No code change required, documentation only.

---

### IN-03: Unused import `BaseMessage` in `runner.ts`

**File:** `packages/core/src/runner/runner.ts:17`

**Issue:** `BaseMessage` is imported from `@langchain/core/messages` and used only to type `historicalMessages` at line 182. However, `historicalMessages` is assigned but never read again after the `logger.debug` call at line 184-189. The variable exists purely for a log count (`historicalMessages.length`). Using `BaseMessage[]` as the explicit type for a variable that is only referenced in a debug log is unnecessary import overhead. The type annotation could be replaced with `unknown[]` or the snapshot length could be read directly.

**Fix:** Remove the import and simplify:

```typescript
// Before (lines 17, 182):
import type { BaseMessage } from "@langchain/core/messages";
const historicalMessages: BaseMessage[] = snapshot?.values?.messages ?? [];

// After:
const historicalMessages: unknown[] = snapshot?.values?.messages ?? [];
// Or more directly:
const historicalCount: number = (snapshot?.values?.messages ?? []).length;
this.logger.debug({ threadId, historicalCount }, "HIST-03: context window snapshot");
```

---

_Reviewed: 2026-06-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
