---
phase: 17-expor-contagem-de-tokens-gastos-na-resposta-da-api-rest-e-ra
reviewed: 2026-06-15T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/brain-echo/src/brain.ts
  - apps/brain-sdr/src/brain.ts
  - packages/ai/package.json
  - packages/ai/src/__tests__/unit/state-token.test.ts
  - packages/ai/src/__tests__/unit/token.test.ts
  - packages/ai/src/graph/state.test.ts
  - packages/ai/src/graph/state.ts
  - packages/ai/src/index.ts
  - packages/ai/src/utils/token.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/runner.ts
  - packages/shared/src/types/index.ts
  - packages/transport/src/__tests__/unit/rabbitmq/consumer.test.ts
  - packages/transport/src/__tests__/unit/webhook-auth.test.ts
  - packages/transport/src/rabbitmq/consumer.ts
  - packages/transport/src/webhook/handler.test.ts
  - packages/transport/src/webhook/handler.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-06-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 17 exposes token usage counts (`tokenUsage`) in the API REST response and RabbitMQ log. The overall implementation is sound: `TokenUsage` type is defined in `@brain-pkg/shared`, `extractTokenUsage()` correctly converts LangChain snake_case to project camelCase, `BrainStateAnnotation` has a summing reducer for accumulation across multiple LLM calls, `BrainRunner.run()` extracts and returns the wrapper `{ brainOutput, tokenUsage }`, and both the webhook handler and RabbitMQ consumer integrate the new shape correctly.

Three warnings were found: one logic inconsistency between `brain-echo` and `brain-sdr` in how messages are returned from the graph node (redundant spread that diverges from the documented pattern), one security-practice gap in the webhook Bearer token comparison (non-timing-safe equality), and one memory concern in the RabbitMQ retry map for entries that never reach MAX_ATTEMPTS.

Two info items flag test file placement violations against the project's CLAUDE.md conventions.

## Warnings

### WR-01: brain-echo returns `[...state.messages, response]` — inconsistent with brain-sdr and the append-reducer contract

**File:** `apps/brain-echo/src/brain.ts:44`

**Issue:** The `llm` node in `brain-echo` returns `messages: [...state.messages, response]`, spreading the full accumulated state plus the new `response` object as the "right" side of `messagesStateReducer`. The reducer merges right into left by message ID: existing messages in `state.messages` already carry stable UUIDs, so they match and are deduplicated — the final result is functionally correct today. However, this pattern is misleading and diverges from `brain-sdr`, which correctly returns only `messages: [response]` (line 88 of `brain-sdr/src/brain.ts`). The comment at line 85 of `brain-sdr` even calls out the correct pattern explicitly.

The risk is twofold: (1) if LangGraph's reducer behaviour changes in a future version, the spread could produce duplicate messages, causing double-history corruption; (2) any future developer reading this code may think the spread is necessary and replicate it in new Brains, eventually hitting a reducer edge case.

**Fix:** Return only the new `response`, matching `brain-sdr`:
```typescript
return {
  messages: [response],   // reducer appends — no spread needed
  brainOutput: {
    fullResponse,
    responseMode: "text" as const,
  },
  tokenUsage: extractTokenUsage(response),
};
```

---

### WR-02: Webhook Bearer token comparison is not timing-safe

**File:** `packages/transport/src/webhook/handler.ts:59`

**Issue:** The token comparison `bearer !== webhookToken` uses JavaScript's `!==` operator, which is a short-circuit string comparison. An attacker who can send many requests and measure response latency can determine the correct token character by character (timing oracle). This is an ASVS V2.9.1 / CWE-208 pattern.

While this endpoint is likely internal (WhatsApp/CRM integration), the Bearer token protects every incoming event. Using a timing-safe comparison is the standard mitigation and costs nothing.

**Fix:** Use Node.js / Bun's built-in `timingSafeEqual` from the `crypto` module:
```typescript
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// In the handler (replace line 59):
if (!bearer || !safeCompare(bearer, webhookToken)) {
  logger.warn({}, "/api/v1/webhook unauthorized attempt");
  return c.json({ error: "Unauthorized" }, 401);
}
```

---

### WR-03: RabbitMQ `retryMap` entries for messages that fail 1–2 times and never resolve are never evicted

**File:** `packages/transport/src/rabbitmq/consumer.ts:41,110,120,134`

**Issue:** The `retryMap` tracks retry attempts per `IDLead:Numero` key. Entries are deleted on success (line 120) and on MAX_ATTEMPTS (line 134), but entries for messages that fail fewer than `MAX_ATTEMPTS` times and then disappear from the queue (e.g., message expires, broker restarts, consumer is restarted before the third attempt) are never cleaned up. In a long-running consumer processing high volumes of distinct leads, these orphaned entries accumulate indefinitely in memory.

The immediate impact is bounded — each entry is a small integer — but the underlying design assumes every message either succeeds or eventually exhausts all retries in the same consumer process lifetime, which is not guaranteed.

**Fix:** Add a TTL-based eviction or cap the map size. A simple approach is to record the timestamp alongside the attempt count and prune on each access:
```typescript
private readonly retryMap = new Map<string, { attempts: number; firstSeen: number }>();
private readonly RETRY_TTL_MS = 10 * 60 * 1000; // 10 minutes

// In the handler, before reading attempt:
const now = Date.now();
const existing = this.retryMap.get(msgKey);
if (existing && now - existing.firstSeen > this.RETRY_TTL_MS) {
  this.retryMap.delete(msgKey); // stale entry — treat as first attempt
}
const attempt = (this.retryMap.get(msgKey)?.attempts ?? 0) + 1;
this.retryMap.set(msgKey, { attempts: attempt, firstSeen: existing?.firstSeen ?? now });
```

## Info

### IN-01: `state.test.ts` and `handler.test.ts` are placed alongside implementation files — violates CLAUDE.md convention

**File:** `packages/ai/src/graph/state.test.ts:1` and `packages/transport/src/webhook/handler.test.ts:1`

**Issue:** CLAUDE.md mandates that all test files live under `__tests__/unit/` or `__tests__/integration/` within the package. These two files are placed next to their implementation files, violating that rule. The new test files added in this phase (`packages/ai/src/__tests__/unit/state-token.test.ts` and `packages/ai/src/__tests__/unit/token.test.ts`) correctly follow the convention — the pre-existing violations were not addressed in this phase.

**Fix:** Move each file to the appropriate directory:
- `packages/ai/src/graph/state.test.ts` → `packages/ai/src/__tests__/unit/state.test.ts`
- `packages/transport/src/webhook/handler.test.ts` → `packages/transport/src/__tests__/unit/webhook/handler.test.ts`

Update the `test` script in `packages/ai/package.json` (line 11) if the path for `state.test.ts` changes.

---

### IN-02: `contextWindowSize` is computed inside the LLM node body on every invocation in `brain-echo`

**File:** `apps/brain-echo/src/brain.ts:28-31`

**Issue:** `brain-echo` computes the context window size via an inline IIFE inside the async node callback on every LLM call. `brain-sdr` correctly extracts this into a named function `getContextWindow()` outside the node (line 71), evaluated once per invocation but clearly separated from the node body. The IIFE pattern is functionally correct but more verbose, harder to read, and inconsistent with the other Brain implementation.

**Fix:** Extract to a named function outside `buildGraph`, matching `brain-sdr`:
```typescript
function getContextWindow(): number {
  const n = parseInt(process.env.CONTEXT_WINDOW_MESSAGES ?? "40", 10);
  return n > 0 && isFinite(n) ? n : 40;
}

// Inside the node:
const messagesForLLM = state.messages.slice(-getContextWindow());
```

---

_Reviewed: 2026-06-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
