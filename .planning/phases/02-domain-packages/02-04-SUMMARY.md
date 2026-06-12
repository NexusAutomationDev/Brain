---
phase: 02-domain-packages
plan: "04"
subsystem: transport
tags: [transport, webhook, hono, zod, dedup, idempotency, ioc-interface]
dependency_graph:
  requires: [02-01]
  provides: [packages/transport]
  affects: [02-07, phase-03-core]
tech_stack:
  added: []
  patterns:
    - "ITransport interface: start(port?)/stop() contract for Webhook and future RabbitMQ"
    - "DedupCache: Map<string, number> TTL evict-on-write pattern (10 min, no setInterval)"
    - "createWebhookApp(): per-instance DedupCache via factory (not module singleton) for test isolation"
    - "createTransport(type?) factory reading TRANSPORT env var with ConfigurationError on unknown value"
    - "BrainEvent zod safeParse: ASVS V5 input validation before any processing"
key_files:
  created:
    - packages/transport/src/interface.ts
    - packages/transport/src/webhook/events.ts
    - packages/transport/src/webhook/dedup.ts
    - packages/transport/src/webhook/handler.ts
    - packages/transport/src/factory.ts
  modified:
    - packages/transport/src/index.ts
    - packages/transport/src/interface.test.ts
    - packages/transport/src/webhook/dedup.test.ts
    - packages/transport/src/webhook/handler.test.ts
    - packages/transport/src/factory.test.ts
decisions:
  - "DedupCache per createWebhookApp() instance (not module singleton) — enables fresh cache per test via beforeEach"
  - "bun install (not pnpm) used in worktree — migrated pnpm lockfile to bun.lock for node_modules resolution"
  - "TTL set to 10 minutes per Claude's discretion (D-03: 5-10 min range)"
metrics:
  duration: "~30 minutes"
  completed: "2026-06-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 5
---

# Phase 2 Plan 04: Transport Package (Webhook) Summary

**One-liner:** Complete `@brain-pkg/transport` with ITransport interface, BrainEvent zod schema, DedupCache TTL dedup, Hono POST /api/v1/webhook handler, and createTransport factory — satisfying TRANS-01 through TRANS-04 and SC-3 (200/409 idempotency).

## What Was Built

### packages/transport/src/interface.ts
`ITransport` TypeScript interface with `start(port?: number): Promise<void>` and `stop(): Promise<void>` contracts. Decouples the webhook implementation from the transport abstraction — RabbitMQ (v2) plugs in without changing consumers.

### packages/transport/src/webhook/events.ts
`BrainEventSchema` zod object validating `conversationId`, `stepIndex`, `userId`, `content` (all required). Optional `metadata` as `Record<unknown>`. Exported as both schema and type via `z.infer`. ASVS V5 input validation — malformed input never reaches processing.

### packages/transport/src/webhook/dedup.ts
`DedupCache` class with `Map<string, number>` store and TTL of 10 minutes. `claim(requestId)` returns `true` on first call, `false` on duplicate within TTL. Evict-on-write pattern removes expired entries on every `claim()` call — no `setInterval` required.

### packages/transport/src/webhook/handler.ts
`createWebhookApp()` returns a Hono app with `POST /api/v1/webhook`. Handler flow:
1. Checks `X-Request-Id` header → 400 if missing
2. `cache.claim(requestId)` → 409 if duplicate (SC-3)
3. `c.req.json()` in try/catch → 400 on JSON parse error
4. `BrainEventSchema.safeParse(body)` → 400 on schema violation
5. Returns `{ status: "accepted" }` — never exposes `thread_id` or session data (T-2-04)

`WebhookTransport` class implements `ITransport` wrapping the Hono app via `Bun.serve`.

**Design note:** `DedupCache` is instantiated inside `createWebhookApp()` (per-instance, not module singleton). This enables `beforeEach(() => { app = createWebhookApp(); })` in tests to get a fresh cache for each test, preventing state leakage between test cases.

### packages/transport/src/factory.ts
`createTransport(transport?)` factory reads `TRANSPORT` env var (defaults to `"webhook"`). Returns `WebhookTransport` for `"webhook"`, throws `ConfigurationError` for unknown values (TRANS-04, D-05).

### packages/transport/src/index.ts
Complete barrel exporting all public symbols: `ITransport`, `BrainEvent`, `BrainEventSchema`, `DedupCache`, `createWebhookApp`, `WebhookTransport`, `createTransport`.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | ITransport interface, BrainEvent schema, DedupCache | 9bcf47f | interface.ts, events.ts, dedup.ts, interface.test.ts, dedup.test.ts |
| 2 | WebhookTransport handler, factory, barrel | 1b56805 | handler.ts, factory.ts, index.ts, handler.test.ts, factory.test.ts |

## Verification Results

```
bun test packages/transport
 15 pass
 0 fail
 21 expect() calls
Ran 15 tests across 4 files.
```

Security checks:
- `grep thread_id packages/transport/src/webhook/handler.ts` → only in comments, never in response body
- `grep safeParse packages/transport/src/webhook/handler.ts` → `BrainEventSchema.safeParse(body)` present

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree missing node_modules for hono/zod**

- **Found during:** Task 2 verification (first test run)
- **Issue:** The worktree is a git worktree without its own `node_modules`. `pnpm install` had been run in the main repo but the worktree is isolated. `bun test` resolved packages from the file path — couldn't find `hono` or `zod`.
- **Fix:** Ran `bun install` in the worktree root, which migrated `pnpm-lock.yaml` to `bun.lock` and installed 380 packages into `node_modules/.bun/`. All tests then resolved correctly.
- **Files modified:** `bun.lock` (created), `node_modules/.bun/*` (package cache)

**2. [Rule 1 - Bug] DedupCache as module singleton causes test state leakage**

- **Found during:** Task 2 implementation review
- **Issue:** The plan's `handler.ts` code sample had `const cache = new DedupCache()` at module level (singleton). This means all `createWebhookApp()` calls share the same cache instance — duplicate X-Request-Id between tests would cause false 409 failures.
- **Fix:** Moved `const cache = new DedupCache()` inside `createWebhookApp()`. Now each `app = createWebhookApp()` in `beforeEach` gets a fresh `DedupCache`, matching the test isolation pattern in `handler.test.ts`.
- **Files modified:** `packages/transport/src/webhook/handler.ts`

## Known Stubs

None — all exported symbols are fully implemented.

## Threat Flags

None — this plan implements the mitigations defined in the threat model:
- T-2-04-01 (replay): `DedupCache.claim()` → 409 ✓
- T-2-04-02 (prompt injection): `BrainEventSchema.safeParse()` → 400 ✓
- T-2-04-03 (info disclosure): response is `{ status: "accepted" }` only ✓
- T-2-04-04 (DoS unbounded cache): accepted (evict-on-write sufficient for v1) ✓

## Self-Check: PASSED
