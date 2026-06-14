---
phase: 05-transport-foundation
reviewed: 2026-06-13T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - apps/brain-echo/src/__tests__/integration/restart.test.ts
  - apps/brain-echo/src/__tests__/integration/webhook.test.ts
  - packages/core/src/runner/__tests__/brain-runner.integration.test.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/runner.ts
  - packages/transport/src/factory.test.ts
  - packages/transport/src/factory.ts
  - packages/transport/src/index.ts
  - packages/transport/src/webhook/events.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/transport/src/webhook/handler.ts
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-06-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the transport foundation layer (Phase 5): `@brain-pkg/transport` (webhook handler, factory, events schema), `@brain-pkg/core` BrainRunner, and the brain-echo integration tests. The implementation is well-structured overall — the `IBrainRunnerLike` duck-typing pattern correctly avoids a circular dependency, the Zod validation at the HTTP boundary is solid, and the fail-fast startup pattern in `init()` is correctly applied for prompt keys.

Two critical issues were found: an unguarded `runner.run()` call that can crash or leak internals on LangGraph/DB errors, and hardcoded credentials with a private IP address in a committed test file. Three warnings cover a missing `DATABASE_URL` runtime guard, discarded memory context (logic gap), and an unreliable integration test graph construction. Three info items cover a dynamic import inside a hot-path, a silent empty-reply fallback, and minor type casting.

---

## Critical Issues

### CR-01: Unhandled error in `runner.run()` can crash or leak internals

**File:** `packages/transport/src/webhook/handler.ts:51`
**Issue:** `await runner.run(event)` has no try/catch. If BrainRunner throws (LangGraph failure, PostgreSQL timeout, network error), the exception propagates unhandled to Hono's default error handler. Depending on Hono/Bun configuration, this can return a 500 response with a stack trace (information disclosure), or cause the process to crash if the error is a rejection in a non-async context. The T-05-03 security note explicitly says internal state must never be returned in the response, but an unguarded throw can violate this.

**Fix:**
```typescript
if (runner) {
  try {
    const result = await runner.run(event);
    return c.json({ status: "ok", reply: result.reply });
  } catch (err) {
    // Log internally but never surface internals to the caller
    console.error({ err }, "BrainRunner.run() failed");
    return c.json({ error: "Internal error" }, 500);
  }
}
```

---

### CR-02: Hardcoded private IP and default credentials in committed test file

**File:** `packages/core/src/runner/__tests__/brain-runner.integration.test.ts:16`
**Issue:** The fallback connection string `"postgresql://postgres:postgres@10.0.1.26:5432/brain_test"` hardcodes a private IP address (`10.0.1.26`) and default PostgreSQL credentials (`postgres:postgres`). This is committed to the repository. If the test file is ever run against an environment where `10.0.1.26` is reachable, it will attempt to connect using these credentials. Even in a CI context, hardcoded IPs and credentials should not exist in source control.

**Fix:**
```typescript
const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error("POSTGRES_URL or TEST_DATABASE_URL must be set to run integration tests");
}
```
Remove the hardcoded fallback entirely. Let the test fail clearly with a diagnostic message if no env var is set, rather than silently connecting to a hardcoded host.

---

## Warnings

### WR-01: Missing runtime guard for `DATABASE_URL` in `_compileGraph()`

**File:** `packages/core/src/runner/runner.ts:179`
**Issue:** `process.env.DATABASE_URL!` uses a non-null assertion. If `DATABASE_URL` is not set, `undefined` is passed to `createCheckpointer()`, which will produce a cryptic downstream error (connection string parse failure) rather than a clear startup error. The fail-fast pattern used for prompt keys (lines 84–93) is not applied here.

**Fix:**
```typescript
private async _compileGraph(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    this.logger.error({ brainId: this.brain.id }, "DATABASE_URL is not set — cannot create checkpointer");
    process.exit(1);
  }
  const checkpointer = await createCheckpointer(dbUrl);
  // ...
}
```

---

### WR-02: Memory context retrieved but never used

**File:** `packages/core/src/runner/runner.ts:133`
**Issue:** `await this.memoryManager.getContext(threadId, event.IDLead, [])` is called but its return value is discarded. The comment says "retrieve context from all 3 layers (MEM-04)" — the intent is to hydrate context for the LLM. However, the retrieved context is never passed into the graph invocation on lines 142–152. The `messages` array sent to `compiledGraph.invoke()` contains only the current turn's human message, with no prior context injected. This is likely a logic gap — the memory retrieval call currently has no observable effect.

**Fix:** Capture the return value and incorporate it into the graph input, or add a comment explicitly documenting that context injection is deferred to a future phase:
```typescript
// Phase X: context is loaded by MemoryManager internally via PostgresSaver checkpointer;
// explicit context injection into messages will be added in Phase 8.
await this.memoryManager.getContext(threadId, event.IDLead, []);
```
If the intent is genuinely that context flows through the checkpointer (not through the messages array), document this clearly so the call does not appear to be dead code.

---

### WR-03: Incorrect `StateGraph` construction in integration test

**File:** `packages/core/src/runner/__tests__/brain-runner.integration.test.ts:51`
**Issue:** `new StateGraph({} as typeof BrainStateAnnotation)` passes an empty object cast as the annotation type. `StateGraph` requires a valid annotation object with channel definitions. This test will likely fail at `graph.compile()` or `graph.addNode()` runtime with a confusing error rather than a meaningful assertion failure, making the test unreliable as a correctness check.

**Fix:** Use the actual `BrainStateAnnotation` import directly, or construct a minimal valid annotation for the test:
```typescript
import { BrainStateAnnotation } from "@brain-pkg/ai";
// ...
const graph = new StateGraph(BrainStateAnnotation);
```

---

## Info

### IN-01: Dynamic import inside `_compileGraph()` (called on every `refreshPrompts()`)

**File:** `packages/core/src/runner/runner.ts:182-183`
**Issue:** `const { drizzle } = await import("drizzle-orm/postgres-js")` is a dynamic import inside a method that is invoked on every `refreshPrompts()` call. Module loader caches the result after the first import, so there is no repeated module evaluation cost, but this is a code smell — static dependencies should be at the top of the file.

**Fix:** Move to a static import at the top of `runner.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
```

---

### IN-02: Silent empty string when no AIMessage found in graph result

**File:** `packages/core/src/runner/runner.ts:159`
**Issue:** If `result.messages` contains no `AIMessage` instances, `reply` is silently `""`. This empty string is persisted to memory and returned to the caller as a valid response. There is no warning log, so this failure mode is invisible in production.

**Fix:** Add a warning log when no AI message is found:
```typescript
if (!lastAI) {
  this.logger.warn(
    { brainId: this.brain.id, threadId, messageCount: messages.length },
    "No AIMessage found in graph result — returning empty reply"
  );
}
const reply = typeof lastAI?.content === "string" ? lastAI.content : "";
```

---

### IN-03: `as any` type cast in integration test assertions

**File:** `apps/brain-echo/src/__tests__/integration/webhook.test.ts:50`
**Issue:** `expect((data as any).error).toBe("Invalid BrainEvent")` uses `as any` to access a field. The same pattern occurs in lines 63 and 50.

**Fix:** Type the response body with an interface or use a type guard:
```typescript
const body = data as { error?: string; status?: string; reply?: string };
expect(body.error).toBe("Invalid BrainEvent");
```

---

_Reviewed: 2026-06-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
