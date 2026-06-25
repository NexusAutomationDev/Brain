---
phase: 20-tool-events
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/core/src/events/__tests__/unit/event-publisher.test.ts
  - packages/core/src/events/event-publisher.ts
  - packages/core/src/index.ts
  - packages/core/src/runner/__tests__/brain-runner.test.ts
  - packages/core/src/runner/runner.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-06-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The phase 20 implementation introduces `EventPublisher` (webhook and RabbitMQ modes) integrated into `BrainRunner` for fire-and-forget tool event dispatch. The overall design is solid: PII-safe logging, whitelist-hardcoded in module scope to prevent prompt injection, correct mode priority (D-06), and clean separation via `IEventPublisher`/`NoopEventPublisher`. No critical security or data-loss issues were found.

Three warnings require attention before this ships: a SIGTERM listener leak in `runner.ts`, an unguarded `tool_call_id` that produces malformed `event_id` values, and a fragile `await Promise.resolve()` in tests that can produce flaky results. Three info-level observations follow.

---

## Warnings

### WR-01: Multiple SIGTERM listeners accumulate if `init()` is called more than once

**File:** `packages/core/src/runner/runner.ts:158`

**Issue:** `process.on('SIGTERM', ...)` registers a new listener every time `init()` is called. Node/Bun EventEmitter does not deduplicate `process.on` calls. In the current lifecycle this only fires once, but if any future code path calls `init()` again (e.g., a full restart-in-place strategy, or a test that instantiates multiple runners in the same process without cleanup), listeners accumulate. Bun/Node emits a `MaxListenersExceededWarning` after 10 listeners and all registered handlers fire on SIGTERM — triggering `close()` N times and calling `process.exit(0)` N times in overlapping async flows.

**Fix:** Replace `process.on` with `process.once`, or remove any existing SIGTERM listener registered by this runner before adding a new one:

```typescript
// Option A — simplest: use once() so the handler self-removes after first SIGTERM
process.once('SIGTERM', async () => {
  this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
  await this.close();
  process.exit(0);
});
```

```typescript
// Option B — if re-init is needed: store and remove before re-adding
private _sigtermHandler: (() => void) | null = null;

// in init(), before registering:
if (this._sigtermHandler) {
  process.off('SIGTERM', this._sigtermHandler);
}
this._sigtermHandler = async () => { ... };
process.on('SIGTERM', this._sigtermHandler);
```

---

### WR-02: `msg.tool_call_id` is not validated before use in `event_id`

**File:** `packages/core/src/runner/runner.ts:286`

**Issue:** The `event_id` is constructed as `` `${threadId}:${msg.tool_call_id}` `` (line 286). `ToolMessage.tool_call_id` is typed as `string` in LangChain but can be `undefined` in practice (e.g., when a tool message is constructed without the property, or when a mock/external message is deserialized without the field). If `tool_call_id` is `undefined`, the resulting `event_id` is `"lead-abc:undefined"` — a string that looks valid but carries no correlation value. This would silently break downstream deduplication (EVT-04) and tracing.

There is no type guard on `msg.tool_call_id` in the whitelist filter block (lines 280–299), only on `msg.name` (line 282).

**Fix:** Add a guard for `tool_call_id` alongside the existing guards:

```typescript
if (
  ToolMessage.isInstance(msg) &&
  typeof msg.name === "string" &&
  typeof msg.tool_call_id === "string" &&   // ADD THIS GUARD
  msg.tool_call_id.length > 0 &&            // prevent empty string event_id suffix
  TOOL_EVENTS_WHITELIST.has(msg.name)
) {
  toolEvents.push({
    event_id: `${threadId}:${msg.tool_call_id}`,
    ...
  });
}
```

---

### WR-03: Single `await Promise.resolve()` is insufficient to flush fire-and-forget publish in tests

**File:** `packages/core/src/runner/__tests__/brain-runner.test.ts:725`

**Issue:** The test uses `await Promise.resolve()` to wait for the fire-and-forget `this.eventPublisher.publish(toolEvents).catch(...)` call to settle before asserting on `mockPublish`. A single microtask tick is only sufficient when `publish()` itself awaits nothing internally. If `publish()` internally has any `await` (and the real `EventPublisher.publish` does — it calls `_publishWebhook` or `_publishRabbitMQ` which both `await`), a single `Promise.resolve()` flush is not enough. Even with the mock (which resolves in one tick), this creates a brittle coupling to mock internals.

**Fix:** Use a more robust flush idiom, or restructure the test to use `waitFor` / retry until condition, or inject a resolvable promise that the test can await explicitly:

```typescript
// Option A — flush several microtask ticks
async function flushMicrotasks(ticks = 5) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

// In test:
await runner.run(makeEvent());
await flushMicrotasks();
expect(mockPublish).toHaveBeenCalledTimes(1);
```

```typescript
// Option B — make mockPublish signal completion via a manually-resolved promise
let resolvePub!: () => void;
const pubDone = new Promise<void>((r) => { resolvePub = r; });
const mockPublish = mock(async (_events: unknown[]) => { resolvePub(); });

// In test:
await runner.run(makeEvent());
await pubDone;  // guaranteed to settle
expect(mockPublish).toHaveBeenCalledTimes(1);
```

---

## Info

### IN-01: `RABBITMQ_URL` is not trimmed before use in `init()`

**File:** `packages/core/src/events/event-publisher.ts:95`

**Issue:** The constructor trims `TOOL_EVENTS_QUEUE` (line 60) and `TOOL_EVENTS_URL` (line 61) to guard against accidental whitespace in ENV values. However, `init()` reads `process.env.RABBITMQ_URL!` raw (line 95) without `.trim()`. If `RABBITMQ_URL` has leading/trailing whitespace (common copy-paste error from `.env` files), the `rabbitmq-client` Connection constructor will receive a malformed URL and may produce a cryptic connection error.

**Fix:**
```typescript
// init(), line 95
this.rabbit = new Connection(process.env.RABBITMQ_URL!.trim());
```

---

### IN-02: Test name "EVT-04 — event_id idempotente" does not match what is actually tested

**File:** `packages/core/src/events/__tests__/unit/event-publisher.test.ts:246`

**Issue:** The test at line 246 verifies that `publish()` forwards the `event_id` unmodified when called twice with the same event. This tests passthrough fidelity, not idempotency. Idempotency would mean the publisher detects a duplicate `event_id` and suppresses the second send — which is explicitly NOT what happens here (the test asserts `fetch` is called twice). The test name and comment are misleading; a future developer may assume `EventPublisher` deduplicates and rely on that non-existent behavior.

**Fix:** Rename the test to clarify the actual behavior:
```typescript
// Before
describe("EVT-04 — event_id idempotente", () => {
  test("publish chamado 2x com mesmo event_id repassa o event_id sem modificar", ...)

// After
describe("EVT-04 — event_id passthrough (sem deduplicação no publisher)", () => {
  test("publish() chamado 2x com mesmo event_id envia ambas as requisições com event_id preservado", ...)
```

If idempotency is actually required (receiver-side deduplication), add a comment documenting that responsibility lies in the consumer, not the publisher.

---

### IN-03: `EventPublisher` and `NoopEventPublisher` exported from public barrel unnecessarily

**File:** `packages/core/src/index.ts:37`

**Issue:** The public barrel exports the concrete `EventPublisher` and `NoopEventPublisher` classes alongside the interface `IEventPublisher`. Brain implementors only need `IEventPublisher` (to type their injected publisher) and `ToolEvent` (to type events). Exporting the concrete classes couples all downstream consumers to the `rabbitmq-client` import chain of `EventPublisher`. In the current monorepo this is acceptable, but if any Brain app tree-shakes or lazy-loads, the RabbitMQ client will be pulled in unconditionally.

This is low-priority given the current Docker-per-Brain deployment model, but worth tracking.

**Fix (optional):** Limit barrel exports to the interface and type:
```typescript
// EVT-01: EventPublisher public API
export type { IEventPublisher, ToolEvent } from "./events/event-publisher.js";
// Keep concrete exports only if consumers need to instantiate directly
// export { EventPublisher, NoopEventPublisher } from "./events/event-publisher.js";
```

If `EventPublisher` must be exported (e.g., for Brain apps that self-manage lifecycle), keep it but add a comment explaining why.

---

_Reviewed: 2026-06-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
