// Schema exports
export * from './schema/tables.js';

// Pool manager exports
export { TenantPoolManager } from './pool-manager.js';
export type { Sql } from 'postgres';

// Re-export Drizzle helpers
export { drizzle } from 'drizzle-orm/postgres-js';
export { eq, and, or, sql } from 'drizzle-orm';

// Migration helper
export { runMigrations } from './migrate.js';
