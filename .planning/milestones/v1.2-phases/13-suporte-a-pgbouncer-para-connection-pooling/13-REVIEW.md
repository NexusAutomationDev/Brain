---
phase: 13-suporte-a-pgbouncer-para-connection-pooling
reviewed: 2026-06-15T21:29:17Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - apps/brain-sdr/src/__tests__/unit/qualifier.unit.test.ts
  - apps/brain-sdr/src/qualifier.ts
  - packages/ai/src/graph/checkpointer.ts
  - packages/database/src/migrate.test.ts
  - packages/database/src/migrate.ts
  - packages/database/src/pool-manager.test.ts
  - packages/database/src/pool-manager.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-15T21:29:17Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 13 introduces PgBouncer compatibility: `prepare: false` via `TenantPoolManager`, row-lock migration strategy (`_schema_lock`), and a `saver.end()` fix in the qualification sub-agent. The implementation is solid overall — the PgBouncer-specific changes are correct. Three warnings and three info items were found; no critical issues.

The most important warning is a **double-close race condition** in `pool-manager.ts`: `closeAll()` iterates the LRU cache and calls `pool.end()` directly, but the LRU `dispose` callback also calls `pool.end({ timeout: 5 })` when `this.pools.clear()` triggers eviction. Each pool ends up with two concurrent `end()` calls. The other warnings concern error handling gaps in retry logic and a test coverage hole for the LRU eviction `dispose` callback.

---

## Warnings

### WR-01: Double-close race in `TenantPoolManager.closeAll()` — `dispose` fires on `clear()`

**File:** `packages/database/src/pool-manager.ts:53-64`

**Issue:** `closeAll()` calls `pool.end({ timeout: 5 })` in the loop, then calls `this.pools.clear()` at line 63. `LRUCache.clear()` triggers the `dispose` callback for every remaining entry, which also calls `pool.end({ timeout: 5 })` (line 26). This means every pool gets two concurrent `end()` calls. The `postgres.js` `Sql.end()` is not guaranteed to be idempotent — calling it twice on the same instance can throw or produce unhandled promise rejections.

**Fix:** Either remove the manual loop and rely solely on the `dispose` callback triggered by `clear()`, or add the `noDisposeOnSet` / call `this.pools.delete(dbName)` (which also fires `dispose`) instead of manually calling `pool.end()`:

```typescript
async closeAll(): Promise<void> {
  // LRUCache.clear() fires dispose() for every entry, which calls pool.end().
  // No need to iterate manually — rely on the dispose hook.
  this.pools.clear();
}
```

If you need to await all closures, collect the promises before clearing:

```typescript
async closeAll(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  for (const [dbName, pool] of this.pools.entries()) {
    closePromises.push(
      pool.end({ timeout: 5 }).catch(err =>
        console.error(`Error closing pool for ${dbName}:`, err)
      )
    );
  }
  // Delete each entry without triggering dispose again
  // (use noDisposeOnSet option or manually track to avoid double-close)
  // Simplest: clear after all end() calls are awaited — dispose will fire
  // but pool.end() should be idempotent at that point.
  await Promise.all(closePromises);
  // Reset the cache without re-disposing (already ended above)
  // Consider using `allowStale: false` and tracking ended pools.
  this.pools.clear(); // <-- this still fires dispose; safest fix is option 1 above
}
```

The cleanest fix is to use the `dispose` hook exclusively and remove the manual loop:

```typescript
async closeAll(): Promise<void> {
  this.pools.clear(); // dispose fires pool.end({ timeout: 5 }) for each entry
}
```

---

### WR-02: Retry loop in `runMigrations()` has an off-by-one — last attempt never retried

**File:** `packages/database/src/migrate.ts:59-65`

**Issue:** The condition for retrying is `isLockNotAvailable(err) && attempt < MAX_RETRIES - 1`. With `MAX_RETRIES = 3`, the guard allows retries when `attempt` is 0 or 1, meaning at most 2 retries (attempt increments to 1 and 2). On the third attempt (`attempt = 2`), the second branch at line 65 (`if (isLockNotAvailable(err))`) throws a descriptive error. This is actually correct behavior and produces 3 total attempts as intended.

However, `attempt` is incremented *before* the sleep but the loop condition `attempt < MAX_RETRIES` is checked at the top. After the third attempt fails (`attempt` becomes 3 after increment), the loop exits naturally but the `throw err` at line 71 would not be reached — the `if (isLockNotAvailable(err))` at line 65 already throws first. If somehow a non-lock error occurs on the *last* attempt, `throw err` at line 71 is reached correctly.

The real issue: **`attempt` is incremented inside the catch block at line 60 but the loop condition `while (attempt < MAX_RETRIES)` is checked at the top.** After a successful `sql.begin()`, `return` exits at line 57 — correct. But if all 3 attempts fail with lock errors, the code path is: attempt=0 fails → `attempt++` → attempt=1, sleep → attempt=1 fails → `attempt++` → attempt=2, sleep → attempt=2 fails → `isLockNotAvailable && attempt < MAX_RETRIES - 1` is `2 < 2` which is **false** → falls to line 65 → throws. This means the third attempt does not sleep (correct) but the error message says "após 3 tentativas" while `MAX_RETRIES = 3` — consistent.

**Actual bug:** After the third attempt fails and `attempt` is 2, the `while` loop would continue (2 < 3 is true) if the `throw` at line 66 were not there. The `throw` at line 66 prevents a fourth loop iteration, but the logic depends on two separate guard conditions instead of a clean loop structure. If a future developer removes one condition, the loop silently runs a 4th attempt. The structure is fragile.

**Fix:** Restructure the retry loop to be explicit about attempt count:

```typescript
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    await sql.begin(async (tx) => { /* ... */ });
    return; // success
  } catch (err: unknown) {
    if (!isLockNotAvailable(err)) throw err; // non-lock errors: propagate immediately
    if (attempt === MAX_RETRIES) {
      throw new Error(
        `[migrate] Não foi possível adquirir lock de migrations após ${MAX_RETRIES} tentativas. ` +
        'Outra instância pode estar executando migrations. Reinicie a aplicação.'
      );
    }
    console.log(`[migrate] Lock não disponível — tentativa ${attempt}/${MAX_RETRIES}, aguardando 200ms`);
    await sleep(200);
  }
}
```

---

### WR-03: `dispose` callback in `TenantPoolManager` is synchronous — `pool.end()` Promise is not awaited

**File:** `packages/database/src/pool-manager.ts:23-28`

**Issue:** The LRU `dispose` callback calls `pool.end({ timeout: 5 })` but does not await the returned Promise. The `lru-cache` `dispose` option is synchronous; there is no built-in mechanism to await async cleanup. This means when a pool is evicted (e.g., when `maxTenants` is exceeded during `getPool()`), the `end()` call fires but the application has no way to know if or when the pool closed cleanly. If requests are in-flight on the evicted pool, they will be abruptly terminated without warning.

```typescript
dispose: (pool, dbName) => {
  pool.end({ timeout: 5 }); // Promise dropped — fire-and-forget
  console.info(`Pool for tenant ${dbName} evicted and closed`);
},
```

**Fix:** This is a known limitation of `lru-cache`'s synchronous `dispose`. The pragmatic fix is to log the error from the dropped promise:

```typescript
dispose: (pool, dbName) => {
  pool.end({ timeout: 5 }).catch(err =>
    console.error(`Error closing evicted pool for tenant ${dbName}:`, err)
  );
  console.info(`Pool for tenant ${dbName} evicted and closed`);
},
```

Alternatively, use `lru-cache`'s `disposeAfter` option (available in lru-cache v10+) or redesign eviction to use a graceful drain queue.

---

## Info

### IN-01: `migrate.ts` uses `console.log` — inconsistent with `pino` logger used elsewhere

**File:** `packages/database/src/migrate.ts:47,54,60`

**Issue:** `runMigrations()` uses `console.log` and `console.info` directly. The project stack specifies `pino` for structured logging. This means migration events are not captured by the structured log pipeline (no JSON output, no log level filtering, no correlation fields).

**Fix:** Import `createLogger` from `@brain-pkg/observability` and use `logger.info()` / `logger.warn()`:

```typescript
import { createLogger } from '@brain-pkg/observability';
const logger = createLogger();

// Replace console.log('[migrate] Row-lock adquirido — iniciando migrations') with:
logger.info('[migrate] Row-lock adquirido — iniciando migrations');
```

---

### IN-02: `pool-manager.ts` uses `console.info` and `console.error` — inconsistent with `pino`

**File:** `packages/database/src/pool-manager.ts:26,47,57-59`

**Issue:** Same as IN-01 — `console.info` and `console.error` are used throughout. The `pool.end()` error in `closeAll()` is logged with `console.error` which bypasses structured logging.

**Fix:** Use `createLogger` from `@brain-pkg/observability` consistently.

---

### IN-03: `pool-manager.test.ts` does not test the `dispose` callback (evicted pool leak path)

**File:** `packages/database/src/pool-manager.test.ts:77-85`

**Issue:** The LRU eviction test (DB-04) only verifies that `postgres()` was called twice — it does not assert that `pool.end()` was called on the evicted pool. Combined with WR-03 (the dropped Promise), the eviction cleanup path has zero test coverage for whether the pool was actually closed.

**Fix:** Capture the `end` mock from the first pool instance and assert it was called after the second `getPool()` triggers eviction:

```typescript
it('calls end() on evicted pool', () => {
  const mgr = new TenantPoolManager(baseConfig, 1);
  mgr.getPool('db1'); // creates pool instance 0
  mgr.getPool('db2'); // evicts db1, creates pool instance 1

  // The first instance's end() should have been called by dispose
  expect(mockPoolInstances[0].end.mock.calls.length).toBe(1);
});
```

---

_Reviewed: 2026-06-15T21:29:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
