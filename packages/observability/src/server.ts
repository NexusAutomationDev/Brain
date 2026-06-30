import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { createLogger } from './logger.js';
import { performHealthCheck } from './health.js';
import type { ITransportLike } from './health.js';

/**
 * D-14/TECH-03: Cria o Hono app com GET /health expandido com status do transport.
 *
 * OBS-02: Exposes health check endpoint per D-13 and D-14.
 * The sql instance is injected so the caller controls which DB connection is checked.
 *
 * Security (T-05-01): Response contains only status, checks, transport (type+connected), version, timestamp.
 * Never includes DATABASE_URL, RABBITMQ_URL, credentials, stack traces, or table names.
 * T-27-03-01: TransportStatus contém apenas type e connected — nunca expõe credenciais.
 * T-27-03-04: transport? é opcional — backward compatible (brain-echo continua sem transport).
 *
 * @param sql - postgres.js Sql instance to use for DB connectivity check
 * @param transport - ITransportLike opcional para expor status de conexão.
 *   Omitido = resposta sem campo transport (backward compatible — brain-echo não precisa alterar).
 */
export function createHealthApp(sql: Sql, transport?: ITransportLike): Hono {
  const app = new Hono();

  app.get('/health', async (c) => {
    const result = await performHealthCheck(sql, transport);

    // D-14/D-16: HTTP status
    // 200 = ok, 503 = db failed OU transport disconnected, 500 = error interno
    const httpStatus =
      result.status === 'ok'
        ? 200
        : result.status === 'degraded' || result.checks.db === 'failed'
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
