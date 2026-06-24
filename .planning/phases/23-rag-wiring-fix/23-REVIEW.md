---
phase: 23-rag-wiring-fix
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - apps/brain-sdr/src/brain.ts
  - apps/brain-sdr/src/__tests__/unit/brain.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-06-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Phase 23 wires `search_knowledge` (RAG) into the SDR Brain graph. The implementation correctly follows the bound-closure pattern (`boundSearchKnowledgeTool` via `createSearchKnowledgeTool(ctx.sql!)`) and adds the tool to both `bindTools()` and `ToolNode`. The router (`routeAfterLlm`), fallback path (D-10), and `respond` node logic are intact. No security vulnerabilities or data-loss risks were found.

Three warnings were identified:

1. A **schema mismatch** between the `qualifyLeadTool` used in `sdrBrain.tools[]` (which still carries `session_id` in its Zod schema) and the `boundQualifyTool` used at runtime (which dropped `session_id` in favor of `config.configurable.thread_id`). A test asserts the presence of `session_id` on the declarative schema, locking in this divergence and obscuring the actual LLM-visible contract.
2. Two `as any` casts in `brain.ts` that bypass TypeScript's type safety at runtime-critical points.

---

## Warnings

### WR-01: Test asserts `session_id` on a schema that does not match the runtime tool contract

**File:** `apps/brain-sdr/src/__tests__/unit/brain.test.ts:61-65`

**Issue:** The test imports `qualifyLeadTool` from `qualifier.ts` and asserts its schema has a `session_id` field. This passes today because the schema on the module-level `qualifyLeadTool` export (the declarative placeholder) still includes `session_id`. However, the `boundQualifyTool` actually passed to `ToolNode` and `bindTools()` in `brain.ts` deliberately removed `session_id` (line 55 comment: "Fix: session_id removido do schema — LLM não sabe o valor real") — the LLM receives only `description`. The test therefore validates a stale contract that the LLM never sees, creating a false sense of correctness for the tool schema. If the test suite is used to gate schema changes, it will block the correct schema from being enforced.

**Fix:** The test should either:
(a) be deleted, since `session_id` is intentionally absent from the operational tool; or
(b) be rewritten to verify the `boundQualifyTool` schema by calling `buildGraph(ctx)` and inspecting the tool registered in the `ToolNode`:

```typescript
// Option (b): verify the bound schema used at runtime
test("boundQualifyTool schema NÃO tem session_id — LLM não vê esse campo", async () => {
  const mod = await import("../../brain.js");
  const bindToolsMock = mock(() => ({
    invoke: mock(async () => ({ content: "", tool_calls: [] })),
  }));
  const capturedTools: any[] = [];
  const capturingMock = mock((tools: any[]) => {
    capturedTools.push(...tools);
    return { invoke: mock(async () => ({ content: "", tool_calls: [] })) };
  });
  const ctx = {
    llm: { bindTools: capturingMock },
    prompts: { system: "s", qualification: "q" },
    tools: [], sql: {} as any, mcpTools: [],
  };
  mod.sdrBrain.buildGraph(ctx as any);
  const qualifyBound = capturedTools.find((t) => t.name === "qualify_lead");
  expect(qualifyBound).toBeDefined();
  const shape = (qualifyBound.schema as any).shape;
  expect(shape).toHaveProperty("description");
  expect(shape).not.toHaveProperty("session_id"); // session_id injetado via thread_id
});
```

---

### WR-02: `as any` cast on `config` silences type error at the tool-call boundary

**File:** `apps/brain-sdr/src/brain.ts:59`

**Issue:** `(config as any)?.configurable?.thread_id` casts the LangGraph `RunnableConfig` to `any` to access `configurable.thread_id`. If the LangGraph API changes the shape of `RunnableConfig.configurable` or the field is renamed, this will silently return `undefined` and `sessionId` will be the empty string `""`. The qualification agent will then fetch history for thread `""`, which is wrong.

**Fix:** Import and use the typed config accessor from LangGraph:

```typescript
import { RunnableConfig } from "@langchain/core/runnables";
// then inside the bound tool:
async ({ description }, config: RunnableConfig) => {
  const sessionId = config?.configurable?.thread_id ?? "";
  // ...
}
```

If `RunnableConfig.configurable` is `Record<string, unknown>`, add a narrow cast only on `thread_id`:

```typescript
const sessionId = (config?.configurable?.thread_id as string | undefined) ?? "";
```

---

### WR-03: `as any` cast on tool_call items in the `llm` node

**File:** `apps/brain-sdr/src/brain.ts:174`

**Issue:** `toolCalls.some((tc: any) => tc.name === "respond")` casts each item to `any`. The `tool_calls` array on `AIMessage` is typed as `ToolCall[]` by LangChain core, so `tc.name` is accessible without a cast. The `as any` hides any future type breakage (e.g., if the field is renamed or moved to `tc.function.name` in a LangChain upgrade).

**Fix:** Use the typed `ToolCall` directly:

```typescript
import type { ToolCall } from "@langchain/core/messages";
// in the llm node:
const toolCalls = (response as AIMessage).tool_calls ?? [];
const hasRespondCall = toolCalls.some((tc: ToolCall) => tc.name === "respond");
const hasOtherToolCall = !hasRespondCall && toolCalls.length > 0;
```

---

## Info

### IN-01: Hardcoded timezone `'America/Sao_Paulo'`

**File:** `apps/brain-sdr/src/brain.ts:150`

**Issue:** The timezone used to format the current time injected into the LLM context is hardcoded as `'America/Sao_Paulo'`. This makes the Brain incorrect for customers in other time zones without a code change.

**Fix:** Read from an environment variable with a sensible default:

```typescript
const nowTz = process.env.BRAIN_TIMEZONE ?? 'America/Sao_Paulo';
```

---

### IN-02: Misleading count in MCP integration test comment

**File:** `apps/brain-sdr/src/__tests__/unit/brain.test.ts:157`

**Issue:** The test description reads `"4 nativas + respond + search_knowledge + 1 MCP"`, but `search_knowledge` is one of the 4 native tools (qualify_lead, pause_session, finish_conversation, search_knowledge). `respond` is the 5th native tool. The comment overcounts by splitting `search_knowledge` out separately. The assertion itself (`toHaveLength(6)`) is correct; only the prose is wrong.

**Fix:** Update the description to avoid confusion:

```typescript
test("buildGraph(ctx) com ctx.mcpTools=[mockTool] chama bindTools com 6 tools (5 nativas + 1 MCP)", async () => {
  // 5 nativas: qualify_lead, pause_session, finish_conversation, search_knowledge, respond
  // + 1 MCP tool = 6 total (Phase 23)
```

---

_Reviewed: 2026-06-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
