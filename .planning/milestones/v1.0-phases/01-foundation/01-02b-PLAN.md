---
phase: 01-foundation
plan: 02b
type: execute
wave: 3
depends_on:
  - 01-02
files_modified:
  - packages/database/src/pool-manager.ts
  - packages/database/src/migrate.ts
  - packages/database/src/index.ts
autonomous: true
requirements:
  - DB-03
  - DB-04
  - DB-05

must_haves:
  truths:
    - "TenantPoolManager creates separate connection pools per DATABASE_NAME"
    - "LRU cache evicts least-recently-used tenant after 20 tenants"
    - "Migration script exits 0 on success and 1 on failure"
  artifacts:
    - path: "packages/database/src/pool-manager.ts"
      provides: "Multi-tenant connection pool with LRU eviction"
      min_lines: 50
      exports: ["TenantPoolManager"]
    - path: "packages/database/src/migrate.ts"
      provides: "Migration script that exits 1 on failure"
      min_lines: 20
      contains: "process.exit(1)"
    - path: "packages/database/src/index.ts"
      provides: "Database package barrel export"
      exports: ["TenantPoolManager", "drizzle"]
  key_links:
    - from: "packages/database/src/pool-manager.ts"
      to: "postgres.js"
      via: "import postgres from 'postgres'"
      pattern: "import postgres from 'postgres'"
    - from: "packages/database/src/migrate.ts"
      to: "drizzle-orm/postgres-js/migrator"
      via: "migrate function"
      pattern: "import.*migrate.*from.*drizzle-orm/postgres-js/migrator"
---

<objective>
Implement multi-tenant connection pool manager with LRU eviction, migration script with container-fail-on-error behavior, and database package barrel exports.

Purpose: Complete the database package with runtime pooling, migration infrastructure, and clean public API for consumers.

Output: A fully functional database package ready for use by observability and future Brain applications.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-02-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement multi-tenant connection pool manager with LRU eviction</name>
  <files>
    packages/database/src/pool-manager.ts
  </files>
  <read_first>
    .planning/phases/01-foundation/01-RESEARCH.md (section: Pattern 1: Multi-Tenant Connection Pool Manager)
    .planning/phases/01-foundation/01-CONTEXT.md (decisions D-09 through D-12)
    .planning/REQUIREMENTS.md (requirements DB-03, DB-04)
  </read_first>
  <action>
Create the TenantPoolManager class:

**packages/database/src/pool-manager.ts:**
Copy the exact implementation from RESEARCH.md section "Pattern 1: Multi-Tenant Connection Pool Manager" which includes:

```typescript
import postgres from 'postgres';
import { LRUCache } from 'lru-cache';
import type { Sql } from 'postgres';

interface PoolConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  max: number;              // D-09: 10-20 connections per pool
  idle_timeout: number;     // D-11: 300 = 5 minutes
}

export class TenantPoolManager {
  private pools: LRUCache<string, Sql>;
  private baseConfig: PoolConfig;

  constructor(config: PoolConfig, maxTenants = 20) {
    this.baseConfig = config;

    // D-10: LRU cache for 20 tenants max
    this.pools = new LRUCache<string, Sql>({
      max: maxTenants,
      dispose: (pool, dbName) => {
        // D-12: Cleanup when evicted
        pool.end({ timeout: 5 });
        console.info(`Pool for tenant ${dbName} evicted and closed`);
      },
    });
  }

  getPool(databaseName: string): Sql {
    let pool = this.pools.get(databaseName);

    if (!pool) {
      pool = postgres({
        ...this.baseConfig,
        database: databaseName,
        max: this.baseConfig.max,
        idle_timeout: this.baseConfig.idle_timeout,
        onnotice: () => {},
      });

      this.pools.set(databaseName, pool);
      console.info(`Created new pool for tenant ${databaseName}`);
    }

    return pool;
  }

  async closeAll(): Promise<void> {
    const closePromises = [];
    for (const [dbName, pool] of this.pools.entries()) {
      closePromises.push(
        pool.end({ timeout: 5 }).catch(err =>
          console.error(`Error closing pool for ${dbName}:`, err)
        )
      );
    }
    await Promise.all(closePromises);
    this.pools.clear();
  }
}
```

This implements DB-03 (multi-tenancy via DATABASE_NAME) and DB-04 (LRU cache with max 20 tenants).
  </action>
  <verify>
    <automated>cd /root/Brain/packages/database && grep -q "class TenantPoolManager" src/pool-manager.ts && grep -q "LRUCache<string, Sql>" src/pool-manager.ts && grep -q "dispose:" src/pool-manager.ts</automated>
  </verify>
  <acceptance_criteria>
    - src/pool-manager.ts exports TenantPoolManager class
    - Constructor accepts PoolConfig and maxTenants (default 20 per D-10)
    - Uses LRUCache with dispose callback for cleanup per D-12
    - getPool() creates new pool with idle_timeout from config (D-11: 300s)
    - getPool() reuses existing pool from cache
    - closeAll() closes all pools and clears cache
    - Uses postgres.js (not bun:sql) per DB-06
  </acceptance_criteria>
  <done>TenantPoolManager implements multi-tenant pooling with LRU eviction per DB-03 and DB-04</done>
</task>

<task type="auto">
  <name>Task 2: Create migration script with container-fail-on-error behavior</name>
  <files>
    packages/database/src/migrate.ts
  </files>
  <read_first>
    .planning/phases/01-foundation/01-RESEARCH.md (section: Pattern 2: Environment-Specific Migration Strategy, section: Pitfall 7)
    .planning/phases/01-foundation/01-CONTEXT.md (decisions D-07, D-08)
    .planning/REQUIREMENTS.md (requirement DB-05)
  </read_first>
  <action>
Create migration script:

**packages/database/src/migrate.ts:**
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);  // D-08: Container fails startup
  }

  // Use max: 1 to avoid interleaved DDL and deadlocks
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  try {
    console.log('Starting migrations...');

    // Create PGVector extension first (DB-02)
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log('PGVector extension enabled');

    // Run Drizzle migrations (D-07: automatic on container startup)
    await migrate(db, { migrationsFolder: './src/migrations' });
    console.log('Migrations completed successfully');
    process.exit(0);  // Success
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);  // D-08: Container fails startup if migration fails
  } finally {
    await sql.end();
  }
}

runMigrations();
```

Per D-07, migrations are applied automatically on container startup. Per D-08, container fails (exit 1) if migration fails.
  </action>
  <verify>
    <automated>cd /root/Brain/packages/database && grep -q "process.exit(1)" src/migrate.ts && grep -q "CREATE EXTENSION IF NOT EXISTS vector" src/migrate.ts && grep -q "migrate(db" src/migrate.ts</automated>
  </verify>
  <acceptance_criteria>
    - src/migrate.ts imports migrate from 'drizzle-orm/postgres-js/migrator'
    - Script exits 1 if DATABASE_URL not set (D-08)
    - Script creates PGVector extension before migrations (DB-02)
    - Script calls migrate() with migrationsFolder './src/migrations'
    - Script exits 0 on success, 1 on failure per D-08
    - Uses max: 1 connection to avoid DDL conflicts
  </acceptance_criteria>
  <done>Migration script implements prod workflow per DB-05 with container-fail-on-error per D-08</done>
</task>

<task type="auto">
  <name>Task 3: Create database package barrel export and verify build</name>
  <files>
    packages/database/src/index.ts
  </files>
  <read_first>
    packages/database/src/pool-manager.ts
    packages/database/src/schema/tables.ts
  </read_first>
  <action>
Create barrel export for database package:

**packages/database/src/index.ts:**
```typescript
// Schema exports
export * from './schema/tables.js';

// Pool manager exports
export { TenantPoolManager } from './pool-manager.js';
export type { Sql } from 'postgres';

// Re-export Drizzle helpers
export { drizzle } from 'drizzle-orm/postgres-js';
export { eq, and, or, sql } from 'drizzle-orm';
```

Then verify the package builds:
1. Run `pnpm --filter @brain-pkg/database build` to compile TypeScript
2. Verify dist/index.js and dist/index.d.ts are created
3. Check that there are no TypeScript errors
  </action>
  <verify>
    <automated>cd /root/Brain && pnpm --filter @brain-pkg/database build && test -f packages/database/dist/index.js && test -f packages/database/dist/index.d.ts</automated>
  </verify>
  <acceptance_criteria>
    - src/index.ts exports all tables from schema/tables.js
    - src/index.ts exports TenantPoolManager class
    - src/index.ts re-exports drizzle and SQL helpers
    - pnpm build produces dist/index.js and dist/index.d.ts
    - Build exits 0 with no TypeScript errors
    - Other packages can import from @brain-pkg/database
  </acceptance_criteria>
  <done>Database package compiles successfully and exports all required entities</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Tenant A database ↔ Tenant B database | Connection pool must enforce database isolation |
| Migration script → database schema | DDL operations are privileged; failure must halt container |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02b-01 | Denial of Service | Connection pool exhaustion | mitigate | LRU cache with max 20 tenants (D-10) and idle_timeout 300s (D-11) prevent unbounded growth; max 20 × 15 connections = 300 total |
| T-02b-02 | Tampering | SQL injection via pool manager | accept | Pool manager uses parameterized queries via Drizzle ORM; getPool() accepts databaseName but uses it as identifier not SQL string |
| T-02b-03 | Elevation of Privilege | Tenant A accessing Tenant B data | mitigate | Each tenant gets isolated database per DATABASE_NAME; connection pool enforces isolation; no shared tables across tenants in v1 |
| T-02b-04 | Denial of Service | Migration failure causing restart loop | mitigate | Migration script exits 1 on failure (D-08); orchestrator keeps old container running on failed deploy; forward-only migrations (D-06) |

</threat_model>

<verification>
After completing all tasks:
1. Run `pnpm --filter @brain-pkg/database build` — should compile with zero errors
2. Run `pnpm typecheck` — should validate entire monorepo
3. Verify pool-manager.ts implements LRU eviction with dispose callback
4. Verify migrate.ts exits 1 on failure
</verification>

<success_criteria>
- ✅ TenantPoolManager implements LRU eviction with max 20 tenants
- ✅ Pool manager uses postgres.js driver per DB-06
- ✅ Migration script exits 1 on failure per D-08
- ✅ Database package compiles and exports all entities
- ✅ Package is ready for consumption by observability and apps
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02b-SUMMARY.md` with:
- Pool manager LRU eviction behavior
- Migration strategy (dev vs prod)
- Files created and their exports
- Integration notes for consumers
- Blockers for next plan (should be none)
</output>
