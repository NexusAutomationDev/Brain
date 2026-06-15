import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * AI-01: Creates and configures a PostgresSaver checkpointer.
 *
 * PostgresSaver uses `pg` (node-postgres) internally — NOT postgres.js.
 * This is intentional: do not attempt to share the postgres.js Sql instance.
 * Both drivers coexist against the same database without conflict.
 *
 * IMPORTANT: setup() is called here so callers do not need to call it separately.
 * Call this once at application startup, not per-request.
 *
 * AI-01 constraint: MemorySaver is NEVER used in production code.
 * MemorySaver is only permitted in *.test.ts files for unit tests without PostgreSQL.
 *
 * PgBouncer compatibility (Phase 13 — D-05):
 * PostgresSaver uses the `pg` (node-postgres v8.21) driver internally, which uses
 * the extended query protocol (prepared statements) for all parameterized queries.
 * There is no pool-level option to disable this in pg v8.21.
 *
 * Supported PgBouncer configurations:
 * - Session mode: fully compatible (recommended)
 * - Transaction mode + PgBouncer >= 1.21 with max_prepared_statements > 0: compatible
 * - Transaction mode + PgBouncer < 1.21: NOT supported — use session mode instead
 * - Direct PostgreSQL (no PgBouncer): always compatible
 *
 * @param connectionString - PostgreSQL connection string (use TEST_DATABASE_URL for tests)
 */
export async function createCheckpointer(connectionString: string): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString);
  // Setup creates the checkpoint tables if they don't exist.
  // Must be called before the first graph invocation.
  await checkpointer.setup();
  return checkpointer;
}
