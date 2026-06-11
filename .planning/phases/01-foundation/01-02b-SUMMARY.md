---
phase: 01-foundation
plan: 02b
subsystem: database
tags: [pool-manager, lru-cache, migrations, multi-tenancy, postgres]
dependency_graph:
  requires: [01-02]
  provides: [packages/database complete with pool manager and migrations]
  affects: [all consumers of @brain-pkg/database]
tech_stack:
  added: []
  patterns:
    - TenantPoolManager with LRU eviction (lru-cache v11, dispose callback)
    - postgres.js connection pool per tenant database
    - Drizzle migrate() with PGVector extension pre-creation
    - Container-fail-on-error migration pattern (process.exit(1))
key_files:
  created:
    - packages/database/src/pool-manager.ts
    - packages/database/src/migrate.ts
    - packages/database/src/index.ts
  modified: []
decisions:
  - Use LRUCache<string, Sql> with dispose callback to close pools on eviction (D-12)
  - max:1 connection in migrate.ts to avoid DDL interleaving and deadlocks
  - Re-export Sql type from postgres for consumers to avoid direct postgres dep
metrics:
  duration_minutes: 20
  completed_date: "2026-06-11"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 1 Plan 2b: Database Pool Manager and Migrations Summary

**One-liner:** TenantPoolManager with LRU eviction (max 20 tenants, idle_timeout 300s) using postgres.js pools per DATABASE_NAME, plus a migration script that enables pgvector extension and exits 1 on failure.

## What Was Built

The `packages/database` package was completed with runtime infrastructure:

1. **TenantPoolManager** (`src/pool-manager.ts`) — multi-tenant connection pooling:
   - LRU cache keyed by `databaseName`, max 20 tenants (D-10)
   - `dispose` callback calls `pool.end({ timeout: 5 })` when evicted (D-12)
   - `idle_timeout` from config (default 300s = 5 minutes per D-11)
   - `max` connections from config (10-20 per D-09)
   - Uses `postgres.js` driver per DB-06 (not `bun:sql`)
   - `getPool()` creates new pool on cache miss, reuses on cache hit
   - `closeAll()` gracefully closes all active pools and clears cache

2. **Migration script** (`src/migrate.ts`) — container-aware migrations:
   - Exits 1 immediately if `DATABASE_URL` not set (D-08)
   - Creates `vector` extension via `CREATE EXTENSION IF NOT EXISTS vector` (DB-02)
   - Runs Drizzle `migrate()` against `./src/migrations` folder (D-07)
   - Uses `max: 1` connection to prevent DDL interleaving
   - Exits 0 on success, 1 on failure (D-08)

3. **Barrel export** (`src/index.ts`) — clean public API:
   - Re-exports all table definitions from `./schema/tables.js`
   - Exports `TenantPoolManager` class
   - Re-exports `Sql` type from `postgres` for consumers
   - Re-exports `drizzle` from `drizzle-orm/postgres-js`
   - Re-exports query helpers: `eq`, `and`, `or`, `sql` from `drizzle-orm`

## Pool Manager Architecture

```
TenantPoolManager
  ├── baseConfig: PoolConfig (host, port, username, password, max, idle_timeout)
  ├── pools: LRUCache<string, Sql> (max = maxTenants, default 20)
  │     └── dispose: pool.end({ timeout: 5 }) on eviction
  ├── getPool(databaseName) → Sql
  │     ├── cache hit → return existing pool
  │     └── cache miss → create new postgres() pool, cache it
  └── closeAll() → Promise<void>
        ├── end all pools concurrently
        └── pools.clear()
```

## Migration Flow (Production)

```
Container startup
  └── bun src/migrate.ts
        ├── Check DATABASE_URL → exit 1 if missing
        ├── Connect with max:1 (avoid DDL conflicts)
        ├── CREATE EXTENSION IF NOT EXISTS vector
        ├── migrate(db, { migrationsFolder: './src/migrations' })
        │     ├── Success → exit 0
        │     └── Failure → exit 1 (orchestrator keeps old container)
        └── sql.end() in finally block
```

## Integration Notes for Consumers

```typescript
import { TenantPoolManager, drizzle, users, eq } from '@brain-pkg/database';

const manager = new TenantPoolManager({
  host: process.env.DB_HOST!,
  port: 5432,
  username: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  max: 15,          // D-09: 10-20 per pool
  idle_timeout: 300, // D-11: 5 minutes
});

// Get pool for a specific tenant
const sql = manager.getPool(process.env.DATABASE_NAME!);
const db = drizzle(sql);

// Query with Drizzle ORM
const allUsers = await db.select().from(users);
```

## Threat Model Mitigations Applied

| Threat | Mitigation Applied |
|--------|--------------------|
| T-02b-01: Connection pool exhaustion | LRU max 20 tenants + idle_timeout 300s limits total connections to 20×max |
| T-02b-03: Tenant A accessing Tenant B | Each tenant gets isolated postgres() connection pointing to separate database |
| T-02b-04: Migration failure restart loop | exit(1) on failure; orchestrator pattern keeps old container running |

## Deviations from Plan

None — plan executed exactly as written. The plan provided the complete implementation patterns and all were applied verbatim.

## Known Stubs

None — all functionality is fully implemented. `getPool()` creates real postgres.js pools, `closeAll()` performs real cleanup, migration script runs real DDL.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model. The `getPool(databaseName)` API accepts a string identifier — this is used as a postgres.js `database` config option, not interpolated into any SQL string, so SQL injection via pool selection is not possible (T-02b-02).

## Self-Check

Files verified:
- [x] `packages/database/src/pool-manager.ts` — EXISTS
- [x] `packages/database/src/migrate.ts` — EXISTS
- [x] `packages/database/src/index.ts` — EXISTS

Commits verified:
- [x] `ee6d2ef` — feat(01-02b): implement TenantPoolManager with LRU eviction
- [x] `f106f9c` — feat(01-02b): create migration script with container-fail-on-error behavior
- [x] `bdd483a` — feat(01-02b): add database package barrel export and verify build

## Self-Check: PASSED
