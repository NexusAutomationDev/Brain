---
created: 2026-07-02T02:10:58.671Z
title: Fix cross-test mock.module pollution in full suite runs
area: testing
files:
  - packages/observability/src/server.test.ts
  - packages/observability/src/__tests__/unit/health-transport.test.ts
  - packages/core/src/events/__tests__/unit/event-publisher.test.ts
  - packages/core/src/__tests__/unit/fup/lead-service-fup.test.ts
---

## Problem

Same class of bug as D-13 (fixed for `brain-runner.test.ts`/`factory.test.ts` in phase 32-01): `bun test`'s `mock.module()` is process-global, so a mock registered in one test file leaks into unrelated test files when the whole package's suite runs together in one `bun test` process — even though each file passes cleanly in isolation.

Confirmed on both a clean pre-phase-32 checkout and current master, so this is pre-existing and unrelated to phase 32's changes. Discovered while running the phase 32 regression gate (`bun run test` at the monorepo root failed; isolating packages one at a time showed these two specific cross-pollutions):

1. **packages/observability**: `src/server.test.ts` calls `mock.module('./health.js', () => ({ performHealthCheck: mock(...), ... }))`. When the package's full test suite runs (`bun test`, 7 files including `dist/*.test.js` build artifacts), this mock leaks into `src/__tests__/unit/health-transport.test.ts`, which expects the real `performHealthCheck()` behavior (transport status, degraded state). Result: 4 failing assertions (`result.transport` undefined, `status` stuck at 'ok'/'error' never 'degraded'). Passes fully (5/5) when run alone.
2. **packages/core**: running the full `bun test` (28 files) produces 14 failures in `event-publisher.test.ts` (EventPublisher webhook/rabbitmq mode tests) and `lead-service-fup.test.ts` (LeadService.resetFup/upsertLead tests) — both pass cleanly (36/36) when run together in isolation from the rest of the suite. The specific offending file(s) causing the leak haven't been isolated yet; needs bisection across the 28 test files (likely another test using `mock.module()` on a shared dependency like `drizzle-orm`, `postgres`, or a transport/queue client).

This means `bun run test` (via turbo, root-level) is NOT a reliable regression signal for these two packages today — CI or any future regression-gate check that runs the full suite will show false failures unrelated to real changes.

## Solution

TBD — likely candidates per D-13's precedent:
- For observability: scope `server.test.ts`'s mock to not leak (e.g. `mock.restore()` in `afterAll`, or move the mocked module boundary to the actual external dependency instead of the sibling `./health.js` module), and also clean stale compiled test artifacts out of `dist/` (`dist/health.test.js`, `dist/logger.test.js`) so `bun test`'s default glob doesn't double-count them.
- For core: bisect which of the 28 test files mocks a module that `event-publisher.test.ts`/`lead-service-fup.test.ts` also depend on, then apply the same "mock the external SDK, not the sibling module" fix pattern used in D-13.
