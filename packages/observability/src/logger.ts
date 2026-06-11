import pino from 'pino';

/**
 * Context to inject into all log lines.
 *
 * OBS-01: Structured JSON logging with tenant and Brain context.
 */
export interface LogContext {
  tenantId?: string;
  brainId?: string;
  sessionId?: string;
  userId?: string;
}

/**
 * Creates a structured JSON logger with context injection.
 *
 * OBS-01: All log lines include tenant/Brain context, ISO timestamp, level, and env.
 *
 * Usage:
 * ```ts
 * const logger = createLogger({ tenantId: 'acme', brainId: 'sdr' });
 * logger.info({ userId: 'user123' }, 'Processing message');
 * // Output: {"level":"info","time":"2026-06-11T10:30:00.000Z","tenantId":"acme","brainId":"sdr","env":"development","userId":"user123","msg":"Processing message"}
 * ```
 *
 * Security note (T-03-01): Never pass DATABASE_URL or secrets in LogContext.
 * Context is intentionally limited to identifiers (tenantId, brainId, sessionId, userId).
 */
export function createLogger(context: LogContext = {}) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      // OBS-01: Include context in all log lines
      ...context,
      env: process.env.NODE_ENV || 'development',
    },
  });
}
