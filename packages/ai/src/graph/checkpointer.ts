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
 * @param connectionString - PostgreSQL connection string (use TEST_DATABASE_URL for tests)
 */
export async function createCheckpointer(connectionString: string): Promise<PostgresSaver> {
  const checkpointer = PostgresSaver.fromConnString(connectionString);
  // Setup creates the checkpoint tables if they don't exist.
  // Must be called before the first graph invocation.
  await checkpointer.setup();
  return checkpointer;
}
