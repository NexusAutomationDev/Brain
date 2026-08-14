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

// Seed helper (SEED-02/SEED-03: per-brain-type seed, separate from drizzle migrations)
export { runBrainSeed } from './seed.js';

// Agent destination lookup (HANDOFF-04): getAgentConnection(sql, name)
export { getAgentConnection } from './agents.js';
export type { AgentConnectionResult } from './agents.js';
