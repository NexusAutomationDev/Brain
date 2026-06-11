import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { createLogger } from './logger.js';
import { performHealthCheck } from './health.js';

/**
 * Creates a Hono application with the GET /health route.
 *
 * OBS-02: Exposes health check endpoint per D-13 and D-14.
 * The sql instance is injected so the caller controls which DB connection is checked.
 *
 * Security (T-05-01): Response contains only status, checks.db, version, timestamp.
 * Never includes DATABASE_URL, credentials, stack traces, or table names.
 *
 * @param sql - postgres.js Sql instance to use for DB connectivity check
 */
export function createHealthApp(sql: Sql): Hono {
  const app = new Hono();

  app.get('/health', async (c) => {
    const result = await performHealthCheck(sql);

    // D-14: HTTP status codes
    // 200 = ok, 503 = dependency (DB) failed, 500 = internal error
    const httpStatus =
      result.status === 'ok'
        ? 200
        : result.checks.db === 'failed'
          ? 503
          : 500;

    return c.json(result, httpStatus);
  });

  return app;
}

/**
 * Starts the HTTP server using Bun.serve.
 *
 * Uses createLogger (pino) for structured logging — consistent with OBS-01.
 * Never logs DATABASE_URL or credentials (T-05-01).
 *
 * @param sql - postgres.js Sql instance for health check
 * @param port - Port to listen on (default: PORT env or 3000)
 */
export function startServer(sql: Sql, port?: number): void {
  const app = createHealthApp(sql);
  const listenPort = port ?? parseInt(process.env.PORT || '3000', 10);
  const logger = createLogger();

  Bun.serve({
    port: listenPort,
    fetch: app.fetch,
  });

  logger.info({ port: listenPort }, 'Health server listening');
}
