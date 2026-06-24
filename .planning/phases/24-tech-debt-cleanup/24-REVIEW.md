---
phase: 24-tech-debt-cleanup
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/core/src/runner/runner.ts
  - packages/core/src/leads/lead-service.ts
  - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
  - packages/core/src/fup/fup-scheduler.ts
  - packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-06-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the BrainRunner, LeadService, FupScheduler, and their unit tests. No critical security vulnerabilities or crash-level bugs were found. Three warnings were identified: one is a silent no-op call in the runner (wasted I/O plus misleading code), one is a silent `NaN` that disables MCP reconnection without any signal, and one is a flaky test pattern using `setTimeout` to verify fire-and-forget behavior. Seven info-level items cover dead test conditionals, weak SQL content assertions, `any` typings, and high cyclomatic complexity in `_processFupForLead`.

---

## Warnings

### WR-01: `memoryManager.getContext()` return value discarded — call is a no-op

**File:** `packages/core/src/runner/runner.ts:294`
**Issue:** `getContext()` is called but its return value is never captured or injected into the graph invocation. The comment acknowledges this ("Context flows through the PostgresSaver checkpointer; explicit message injection deferred to Phase 8"), but the call still performs real I/O (DB reads) with no effect on the LLM's input. This is misleading to readers — it looks like memory is being applied when it is not — and wastes a round-trip on every `run()` call.
**Fix:** Either remove the call until Phase 8 implements the injection, or add a prominent `// TODO(Phase-8): inject returned context into graph` comment and assign the result so the intent is clear:
```typescript
// TODO(Phase-8): inject memoryContext into graph invocation
const _memoryContext = await this.memoryManager.getContext(threadId, event.IDLead, []);
```
Removing entirely is cleaner if injection is not yet wired up.

---

### WR-02: `parseInt(MCP_SESSION_TTL_MS)` returns `NaN` on invalid input, silently disabling MCP reconnection

**File:** `packages/core/src/runner/runner.ts:88-89`
**Issue:** `parseInt(process.env.MCP_SESSION_TTL_MS ?? "240000", 10)` produces `NaN` if the ENV value is non-numeric (e.g., `MCP_SESSION_TTL_MS=disabled`). The comparison on line 242 — `Date.now() - this.mcpInitTime > this.mcpSessionTtlMs` — is always `false` when `mcpSessionTtlMs` is `NaN`, so MCP sessions are never reconnected. There is no log or startup error to indicate this.
**Fix:** Validate and fall back explicitly:
```typescript
private readonly mcpSessionTtlMs: number = (() => {
  const parsed = parseInt(process.env.MCP_SESSION_TTL_MS ?? "240000", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // warn at runtime if we have a logger, otherwise default
    return 240_000;
  }
  return parsed;
})();
```
Or validate in `init()` and log a warning if the value is not usable.

---

### WR-03: Flaky fire-and-forget test assertion using `setTimeout(resolve, 10)`

**File:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts:253` and `277`
**Issue:** Both EVT-03 tests wait 10ms after `_processFupForLead()` resolves before asserting that `publishMock` was called. The `eventPublisher.publish()` is fire-and-forget (`.catch()` only), so the assertion races against microtask scheduling. Under CI load or a slower runtime, 10ms may not be enough and the test will spuriously fail (false negative).
**Fix:** Make `publishMock` return a resolved promise and flush microtasks instead of relying on a wall-clock delay. Bun's `bun:test` does not expose `queueMicrotask` flush, but you can await a resolved promise chain to drain the microtask queue:
```typescript
// After _processFupForLead resolves, drain the microtask queue
await Promise.resolve();
await Promise.resolve(); // two awaits to cover chained .catch()

expect(publishMock).toHaveBeenCalledTimes(1);
```
This is deterministic and does not rely on wall-clock time.

---

## Info

### IN-01: `compiledGraph` and `checkpointer` typed as `any` — type safety gap

**File:** `packages/core/src/runner/runner.ts:76` and `83`
**Issue:** Both fields are declared as `any | null`. The TypeScript compiler cannot catch method call errors on these fields. The comment acknowledges this with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`, but providing a minimal structural interface would restore compile-time safety without requiring a direct import of the LangGraph internals.
**Fix:** Define a local interface for the compiled graph (similar to the `ICheckpointerLike` pattern in `fup-scheduler.ts`):
```typescript
interface CompiledGraphLike {
  getState(config: { configurable: { thread_id: string } }): Promise<{ values?: { messages?: unknown[] } } | undefined>;
  invoke(input: unknown, config: unknown): Promise<Record<string, unknown>>;
}
private compiledGraph: CompiledGraphLike | null = null;
```

---

### IN-02: Dead conditional in `_sendFupWebhook` monkey-patch in test

**File:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts:105`
**Issue:** The ternary `scheduler["opts" as keyof typeof scheduler] ? "http://..." : "http://..."` always evaluates the left branch because `opts` is always defined on a constructed `FupScheduler`. Both branches produce the same URL string. The condition is dead code that adds confusion without benefit.
**Fix:** Simplify to a direct string:
```typescript
(scheduler as unknown as { _sendFupWebhook: Function })._sendFupWebhook = async (lead: FupLeadRowMock, message: string) => {
  const response = await fetchMockFn("http://localhost:3001/fup-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Name: lead.nome ?? "", Numero: lead.numero, Message: message, IDLead: lead.uniqueId }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`FUP webhook retornou ${response.status} para lead ${lead.uniqueId}`);
  }
};
```

---

### IN-03: SQL content assertions in tests do not verify the value — only the column name

**File:** `packages/core/src/__tests__/unit/fup/fup-scheduler.test.ts:187-189` and `213-215`
**Issue:** The tests verify that SQL template strings contain the literal text `"ia_ativada"` and `"fup_enabled"`, but not what value is being set. A regression that sets `ia_ativada = true` when it should be `false` would pass these tests. The `updateCallStrings` approach captures the static parts of the template tag, not the interpolated values.
**Fix:** Either spy on the raw `sql` template and capture interpolated arguments, or restructure to use a Drizzle mock (similar to `lead-service-fup.test.ts`) that captures the exact `set()` payload. At minimum, document the known limitation in a comment so reviewers are aware.

---

### IN-04: `resetFup()` runs unconditionally before `ia_ativada` gate — may clear FUP for human-agent sessions

**File:** `packages/core/src/runner/runner.ts:261`
**Issue:** `resetFup()` is called before the `if (!lead.iaAtivada) return null` gate on line 265. When a lead has `ia_ativada=false` (human agent handling), any incoming message — including messages sent by the human agent's CRM — clears the pending FUP cycle (`fup_next_at=NULL`, `fup_step=0`). This may or may not be intentional depending on whether human agent messages arrive via the same webhook path. If they do, the FUP cycle is silently destroyed on every human reply.
**Fix:** Clarify intent with a comment. If the behavior is intentional (any incoming message, regardless of source, cancels FUP), document it explicitly. If it should only cancel FUP for lead-initiated messages, move `resetFup()` to after the gate:
```typescript
if (!lead.iaAtivada) {
  this.logger.debug({ numero: event.Numero }, "ia_ativada=false — ignoring message");
  return null;
}
// FUP reset only for messages the AI actually processes
await this.leadService.resetFup(lead.uniqueId);
```

---

### IN-05: New LLM client created on every `_generateFupMessage` call

**File:** `packages/core/src/fup/fup-scheduler.ts:291`
**Issue:** `await createLLM()` is called once per lead per tick. With `BATCH_SIZE=10`, this creates up to 10 LLM client instances per polling cycle. If `createLLM()` performs any non-trivial initialization (SDK client construction, auth token fetch), this is wasteful and adds latency to each FUP.
**Fix:** Instantiate the LLM once in the constructor or in `start()` and reuse it across calls:
```typescript
private llm: Awaited<ReturnType<typeof createLLM>> | null = null;

async start(): Promise<void> {
  this.llm = await createLLM();
  // ...
}
```
Then in `_generateFupMessage`: `const response = await this.llm!.invoke([...])`.

---

### IN-06: `!` non-null assertion on fallback array access with potential empty array

**File:** `packages/core/src/fup/fup-scheduler.ts:198-199`
**Issue:** `lead.intervalsSeconds[lead.intervalsSeconds.length - 1]!` uses `!` to assert non-null, but if `intervalsSeconds` is an empty array (misconfigured `fup_config`), this evaluates to `undefined`, and `undefined * 1000` is `NaN`. The WHERE clause in the tick query guards against this at query time (`fup_step < array_length(...)`), but the `!` assertion creates a false sense of safety in the code path.
**Fix:** Add an explicit guard or a comment explaining the query-level precondition:
```typescript
const lastInterval = lead.intervalsSeconds[lead.intervalsSeconds.length - 1];
// Safe: WHERE clause guarantees intervalsSeconds is non-empty when this code runs
const intervalMs = ((lead.intervalsSeconds[nextFupStep] ?? lastInterval ?? 3600) * 1000);
```

---

### IN-07: High cyclomatic complexity in `_processFupForLead`

**File:** `packages/core/src/fup/fup-scheduler.ts:147-277`
**Issue:** The method is 130 lines and contains: a DB query, a retry loop (3 iterations), two distinct UPDATE branches (last FUP vs intermediate), `getNextValidSlot` computation, fire-and-forget event publishing, and a failure-count update path. Cyclomatic complexity is approximately 9. This makes the method difficult to unit test exhaustively — the existing tests cover the main paths but cannot easily test intermediate-step interval calculation in isolation.
**Fix:** Extract sub-methods: `_updateSuccessStep(lead, nextFupStep)` and `_updateFailure(lead, newCount)`. This reduces cognitive load and improves testability without changing behavior.

---

_Reviewed: 2026-06-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
