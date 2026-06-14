---
phase: 07-leadservice-rabbitmq-transport
fixed_at: 2026-06-14T03:30:00Z
review_path: .planning/phases/07-leadservice-rabbitmq-transport/07-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 07: Code Review Fix Report

**Fixed at:** 2026-06-14T03:30:00Z
**Source review:** .planning/phases/07-leadservice-rabbitmq-transport/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 Critical + 4 Warning)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: PII leaked to logs when RabbitMQ payload fails schema validation

**Files modified:** `packages/transport/src/rabbitmq/consumer.ts`
**Commit:** 72def70
**Applied fix:** Replaced `{ body: msg.body }` with `{ bodyKeys: Object.keys(msg.body ?? {}) }` in the `logger.error` call inside the `!parsed.success` branch. Also added a comment referencing T-07-08. Only the top-level key names of the invalid payload are now logged — the actual values (which may contain PII such as phone numbers or names) are never written to the log record.

### WR-01: Non-null assertion on `this.pub` without a null guard

**Files modified:** `packages/transport/src/rabbitmq/consumer.ts`
**Commit:** 9bdcb4f
**Applied fix:** Added an explicit `if (!this.pub)` guard at the very top of the async consumer message callback, before any code that uses `this.pub`. If `pub` is undefined (e.g. during teardown), the handler logs an error and returns `ConsumerStatus.ACK` immediately. Both `this.pub!.send(...)` calls were changed to `this.pub.send(...)` since the guard above guarantees non-null for any code path that reaches them.

### WR-02: `threadId` uses `event.Numero` instead of `lead.uniqueId`

**Files modified:** `packages/core/src/runner/runner.ts`
**Commit:** 80d8300
**Applied fix:** Replaced `const threadId = event.Numero` with `const threadId = lead.uniqueId`. The `lead` object is already available in the same function scope (returned by `upsertLead` a few lines above). The stale Phase 8 placeholder comment was replaced with an explanatory comment describing why `lead.uniqueId` is the correct canonical key for LangGraph's `thread_id`.

### WR-03: `console.error` in webhook handler instead of structured logger

**Files modified:** `packages/transport/src/webhook/handler.ts`
**Commit:** 670367f
**Applied fix:** Added `import { createLogger } from "@brain-pkg/observability"` and a module-level `const logger = createLogger()`. Replaced the single `console.error({ err }, "BrainRunner.run() failed")` call in the catch block with `logger.error({ err }, "BrainRunner.run() failed")`. This routes the error through pino's structured serialiser, including the `level` field and proper error serialisation, consistent with the rest of the codebase.

### WR-04: `createTransport` silently passes `undefined` runner to `RabbitMQTransport`

**Files modified:** `packages/transport/src/factory.ts`
**Commit:** 9a072f0
**Applied fix:** Added an explicit `if (!runner)` guard in the `"rabbitmq"` case before constructing `RabbitMQTransport`. If `runner` is absent, a `ConfigurationError` is thrown immediately at the factory call site — rather than at the first message processed by the consumer — with a clear diagnostic message pointing to the misconfiguration. The non-null assertion `runner!` was removed; `runner` is passed directly (TypeScript now narrows it to non-undefined after the guard).

---

_Fixed: 2026-06-14T03:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
