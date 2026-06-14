---
phase: 08-brainrunner-conversation-history
reviewed: 2026-06-14T18:54:54Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
  - packages/core/src/runner/runner.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - apps/brain-echo/src/brain.ts
  - apps/brain-echo/src/__tests__/unit/brain.test.ts
  - apps/brain-echo/.env.example
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-06-14T18:54:54Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This phase implements conversation history persistence in BrainRunner via PostgresSaver checkpointing (HIST-01 through HIST-03). The implementation is well-structured: `thread_id` is correctly anchored to `lead.uniqueId` (not `event.Numero`), the context window ENV guard (`T-08-ENV`) is applied consistently in both `runner.ts` and `brain.ts`, and the unit/integration test split follows project conventions.

One critical issue was found: `runner.ts` reads `CONTEXT_WINDOW_MESSAGES` from `process.env` at call time but never uses the parsed value to actually slice or gate messages passed to the graph — the variable `contextWindowSize` is computed and logged but serves no functional purpose in `run()`. The actual truncation lives inside the graph node in `brain.ts`, which is the correct place per the architecture comments, but the dead computation in `runner.ts` is a logic smell that could mislead future maintainers and creates inconsistent behavior if the graph node ever changes.

Three warnings concern: (1) `process.exit(1)` inside `_compileGraph()` for a missing `DATABASE_URL` — this bypasses the normal error-propagation path that callers of `refreshPrompts()` would expect; (2) a `console.log` in the integration test that will emit noise in CI; (3) a fragile internal-API access pattern in the brain test (`graph.nodes?.["llm"]?.action ?? graph._nodes?.["llm"]?.runnable?.func`) that depends on LangGraph private fields and will silently fall through to the fallback branch without warning.

---

## Critical Issues

### CR-01: `contextWindowSize` computed in `run()` but never used to truncate messages

**File:** `packages/core/src/runner/runner.ts:177-193`
**Issue:** The `CONTEXT_WINDOW_MESSAGES` value is parsed, validated, and stored in `contextWindowSize` (line 179), then logged alongside `historicalMessages.length` and `willTruncate` (lines 185-192). However, neither `contextWindowSize` nor `historicalMessages` is ever used to modify the messages sent to the graph. The `invoke()` call on line 207 passes only `{ messages: [{ role: "human", content: event.Message }] }` — the full checkpoint history is replayed by the PostgresSaver automatically. The actual truncation logic lives inside the graph node in `brain.ts` (line 32: `state.messages.slice(-contextWindowSize)`).

This creates two problems:
1. The log line `willTruncate: historicalMessages.length > contextWindowSize` reports a boolean that is never acted upon at the runner level — it is misleading: the runner never truncates anything.
2. `historicalMessages` is fetched via `getState()` (a real async DB round-trip) solely to populate a log line. This adds latency to every `run()` call with no functional benefit.

The `getState()` call was presumably added to read history before invoking, but the comment on line 176 explicitly says "NÃO re-injetar historicalMessages no invoke() — causaria duplicação (Pitfall 1)". The combination of fetching state, computing a truncation window, and then doing nothing with either is a logic error that will confuse future maintainers and adds unnecessary DB overhead.

**Fix:** Either remove the dead `getState()` block entirely (since truncation is correctly handled inside the graph node), or, if the audit log is intentional, rename `willTruncate` to `historySize` and remove the misleading truncation framing:

```typescript
// Option A — remove the block entirely (preferred, truncation handled in graph node)
// Delete lines 176–192 in runner.ts

// Option B — keep for observability only, rename to remove misleading semantics
const snapshot = await this.compiledGraph.getState({
  configurable: { thread_id: threadId },
});
const historicalMessages: BaseMessage[] = snapshot?.values?.messages ?? [];
this.logger.debug(
  {
    threadId,
    historicalMessageCount: historicalMessages.length,
    contextWindowSize,
  },
  "HIST-03: checkpoint state before invoke"
);
// Note: truncation is applied inside the graph node, not here
```

---

## Warnings

### WR-01: `process.exit(1)` inside `_compileGraph()` for missing `DATABASE_URL` bypasses error propagation

**File:** `packages/core/src/runner/runner.ts:241-244`
**Issue:** `_compileGraph()` is a private method called both by `init()` and by `refreshPrompts()`. When `DATABASE_URL` is missing, it calls `process.exit(1)` directly. In `init()`, hard exit is the documented fail-fast pattern. However, `refreshPrompts()` is called at runtime by a POST `/reload-prompts` handler — a hard exit there brings down the entire process in response to a management API call, which a caller can trigger after deployment. A thrown error would let the HTTP handler respond with a 500 and keep the process alive.

**Fix:** Throw a `ConfigurationError` instead of calling `process.exit(1)` in `_compileGraph()`, and keep the `process.exit(1)` only inside `init()` by catching the error there:

```typescript
// In _compileGraph() — throw instead of exit
private async _compileGraph(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new ConfigurationError(
      "DATABASE_URL is not set — cannot create checkpointer",
      { brainId: this.brain.id }
    );
  }
  // ...
}

// In init() — catch and exit
async init(): Promise<void> {
  // ...
  await this._compileGraph().catch((err: unknown) => {
    this.logger.error({ brainId: this.brain.id, err }, "Graph compilation failed — aborting init");
    process.exit(1);
  });
}

// In refreshPrompts() — let the error propagate to the HTTP handler
async refreshPrompts(): Promise<void> {
  this.logger.info({ brainId: this.brain.id }, "Refreshing prompts");
  this.prompts = await loadPrompts(this.sql, this.brain.brainType, this.brain.promptKeys);
  await this._compileGraph(); // throws ConfigurationError — caller handles it
  this.logger.info({ brainId: this.brain.id }, "Prompts refreshed and graph recompiled");
}
```

### WR-02: `console.log` calls in integration test emit noise in CI

**File:** `packages/core/src/runner/__tests__/brain-runner.integration.test.ts:117,135,147`
**Issue:** Three `console.log` calls are present in the HIST-00 test body (lines 117, 135, 147). The project uses `pino` via `createLogger()` for structured logging. Bare `console.log` in tests produces unstructured output that pollutes `bun test` CI output and cannot be filtered or silenced via log-level configuration.

```typescript
// Line 117
console.log("✓ init() completed successfully");
// Line 135
console.log("✓ run() returned:", result);
// Line 147
console.log("✓ Second call completed:", result2);
```

**Fix:** Remove the `console.log` calls. The assertions already validate the behavior; the log lines add no correctness value. If milestone-style output is desired for long-running integration tests, use `bun test`'s built-in test-name reporting.

### WR-03: Fragile LangGraph internal API access in brain unit test will silently pass via fallback

**File:** `apps/brain-echo/src/__tests__/unit/brain.test.ts:135`
**Issue:** The test on line 135 accesses LangGraph internals to extract a node handler:

```typescript
const nodeHandler = graph.nodes?.["llm"]?.action ?? graph._nodes?.["llm"]?.runnable?.func;
```

Neither `nodes` nor `_nodes` is a documented public API of `StateGraph`. If LangGraph changes its internal structure (as it has done between minor versions), `nodeHandler` will be `undefined` and the test silently falls through to the fallback branch (lines 145-149), which tests only a plain `Array.prototype.slice` — not the actual node behavior. The test will report green while the real node is untested.

The comment on line 143 acknowledges this: "Fallback: testar apenas a lógica de slice sem invocar o nó". This means the primary intent of this test case can silently go uncovered with no failure signal.

**Fix:** Remove the internal-API path and keep only the fallback, OR restructure the test to extract the node function in a way that does not rely on LangGraph internals. The simplest safe approach is to extract the node function into a named export so it can be tested directly:

```typescript
// In brain.ts — extract node fn for testability
export function makeLlmNode(ctx: BrainBuildContext) {
  return async (state: { messages: BaseMessage[] }) => {
    const contextWindowSize = (() => {
      const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
      return n > 0 && isFinite(n) ? n : 40;
    })();
    const messagesForLLM = state.messages.slice(-contextWindowSize);
    const response = await ctx.llm.invoke([
      { role: "system", content: ctx.prompts["system"] },
      ...messagesForLLM,
    ]);
    return { messages: [...state.messages, response] };
  };
}

// In brain.test.ts — import and test directly
import { makeLlmNode } from "../../brain.js";
const nodeFn = makeLlmNode(ctx);
await nodeFn(fakeState);
```

---

## Info

### IN-01: `mockUpsertLead.mockClear()` in `beforeEach` does not reset call count globally across describe blocks

**File:** `packages/core/src/runner/__tests__/brain-runner.test.ts:221`
**Issue:** `mockUpsertLead.mockClear()` is called in the `beforeEach` of the nested `describe("gate ia_ativada")` block. However, `mockUpsertLead` is a module-level mock shared across all tests in the file. The HIST-03 tests (lines 283-339) also call `runner.run()` which invokes `mockUpsertLead`, but the HIST-03 `afterEach` only restores the ENV variable — it does not clear the mock. Test isolation is currently maintained by chance (order of execution), not by explicit cleanup.

**Fix:** Add `mockUpsertLead.mockClear()` to the `beforeEach` in the HIST-03 `describe` block as well, or hoist the `mockClear()` to the top-level `beforeEach`:

```typescript
// In the top-level describe("BrainRunner") beforeEach
beforeEach(() => {
  registry = new ToolsRegistry();
  registry.enableTool("test", "dummy");
  mockUpsertLead.mockClear(); // isolate across all test groups
});
```

### IN-02: `.env.example` contains a placeholder secret value that mimics a real key format

**File:** `apps/brain-echo/.env.example:21`
**Issue:** The line `OPENAI_API_KEY=sk-...` uses the `sk-` prefix that matches real OpenAI API key format. While `sk-...` is clearly a placeholder, some secret-scanning tools (e.g., `gitleaks`, `truffleHog`) may flag the `sk-` prefix pattern as a potential key and produce false positives in CI.

**Fix:** Use a clearly non-key placeholder:

```bash
OPENAI_API_KEY=your-openai-api-key-here
```

### IN-03: `ADMIN_TOKEN=change-me-in-production` in `.env.example` is a weak placeholder warning

**File:** `apps/brain-echo/.env.example:20`
**Issue:** `ADMIN_TOKEN=change-me-in-production` is a known weak placeholder. While `.env.example` files are not deployed, developers who copy this file and forget to change the token would expose the reload-prompts and admin endpoints with a predictable, publicly visible token string.

**Fix:** Use a clearly non-functional placeholder that communicates the requirement to generate a random secret:

```bash
# Generate with: openssl rand -hex 32
ADMIN_TOKEN=REPLACE_WITH_RANDOM_SECRET
```

---

_Reviewed: 2026-06-14T18:54:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
