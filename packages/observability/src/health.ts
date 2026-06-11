import type { Sql } from 'postgres';

/**
 * Health check result structure per D-13.
 *
 * @property status - Overall system health: 'ok' | 'degraded' | 'error'
 * @property checks - Individual check results
 * @property version - Git commit hash or 'unknown' (Claude's discretion: included for debugging)
 * @property timestamp - ISO 8601 timestamp
 *
 * Future fields (D-15 - deferred to Phase 2 when transport package exists):
 * @property transport - Transport type ('webhook' | 'rabbitmq') - WILL BE ADDED IN PHASE 2
 *
 * Security note (T-03-02): This response exposes only status and boolean checks.
 * Never include connection strings, usernames, or passwords in health check output.
 */
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    db: 'connected' | 'failed';
    // Future: transport?: 'webhook' | 'rabbitmq' (D-15 - Phase 2)
  };
  version?: string;
  timestamp: string;
  // transport?: string; // D-15: Will be added in Phase 2 when transport package exists
}

/**
 * Validates database connectivity by executing a lightweight query.
 *
 * OBS-02: Returns true if database is reachable, false on any error.
 * Security note (T-03-03): SELECT 1 is fast (<1ms); postgres.js has built-in query timeouts.
 */
export async function checkDatabase(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Performs a full health check and returns structured JSON result.
 *
 * OBS-02: Validates database connectivity and returns HealthCheckResult per D-13.
 *
 * HTTP status code mapping (D-14) — applied by the caller (Hono route):
 * - 200: status === 'ok'
 * - 503: checks.db === 'failed' (dependency unavailable)
 * - 500: status === 'error' (internal error)
 *
 * Note: D-15 defers transport field to Phase 2 when transport package exists.
 * The commented fields in HealthCheckResult interface are placeholders for Phase 2.
 *
 * Usage in Hono app:
 * ```ts
 * app.get('/health', async (c) => {
 *   const result = await performHealthCheck(sql);
 *   const statusCode = result.status === 'ok' ? 200
 *     : result.checks.db === 'failed' ? 503
 *     : 500;
 *   return c.json(result, statusCode);
 * });
 * ```
 */
export async function performHealthCheck(sql: Sql): Promise<HealthCheckResult> {
  const dbOk = await checkDatabase(sql);

  // D-13: Structured JSON response with status and checks
  return {
    status: dbOk ? 'ok' : 'error',
    checks: {
      db: dbOk ? 'connected' : 'failed',
    },
    version: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
  };
}
