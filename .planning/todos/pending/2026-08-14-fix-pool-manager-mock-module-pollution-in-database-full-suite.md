---
created: 2026-08-14T01:23:00.785Z
title: Fix pool-manager.test.ts mock.module('postgres') pollution in packages/database full suite runs
area: testing
files:
  - packages/database/src/pool-manager.test.ts
  - packages/database/src/__tests__/integration/seed-idempotency.test.ts
  - packages/database/src/__tests__/integration/agents.integration.test.ts
---

## Problem

Same class of bug as the existing `2026-07-02-fix-cross-test-mock-module-pollution-in-full-suite-runs.md` todo (D-13's precedent, `bun test`'s `mock.module()` is process-global): `packages/database/src/pool-manager.test.ts` calls `mock.module('postgres', () => ({ default: mockPostgresFactory }))` at module scope, with no `afterAll` restore. When the *entire* `packages/database` suite runs in one `bun test` process (`bun test`, no path filter), this mock leaks into every file that imports the real `postgres` package afterward in the same worker — including `seed-idempotency.test.ts` and the new `agents.integration.test.ts` (Phase 34-02), both of which need a real `postgres(url)` connection against a real Postgres instance.

Symptom: `TypeError: Object is not a function (near '...sql\`INSERT INTO ...\`...')` — `postgres()` returns `mockPostgresFactory`'s plain `{ end: mock(...) }` object instead of a real tagged-template-callable `Sql` instance, so any `sql\`...\`` call in the affected file throws.

Confirmed on unmodified master (before Phase 34-02's changes) that `seed-idempotency.test.ts` already exhibits this failure when run as part of the full `bun test` suite together with `pool-manager.test.ts` — pre-existing, not introduced by 34-02. Both `seed-idempotency.test.ts` and the new `agents.integration.test.ts` pass 100% (22/22 across the `__tests__/integration/` folder) when run via `bun test src/__tests__/integration` (i.e. without `pool-manager.test.ts` in the same process).

This means `bun test` (full `packages/database` suite, no path filter) is NOT a reliable regression signal today when `TEST_DATABASE_URL`/`POSTGRES_URL` is set — any real-Postgres integration test that shares a worker with `pool-manager.test.ts` will show false failures unrelated to real changes.

## Solution

TBD — likely candidates per the existing todo's precedent:
- Add an `afterAll` in `pool-manager.test.ts` that restores `mock.module('postgres', ...)` back to the real module (re-`import`/`require` the actual `postgres` package and re-register it), so the mock doesn't leak past this file's own test block.
- Alternatively, scope the mock via dependency injection into `TenantPoolManager` instead of module-level `mock.module()`, avoiding global module-registry mutation entirely.
- Whichever fix is chosen, verify by re-running the full `bun test` (with `TEST_DATABASE_URL` set to a real scratch Postgres) and confirming `seed-idempotency.test.ts` + `agents.integration.test.ts` both pass alongside `pool-manager.test.ts` in the same process.
