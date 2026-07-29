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
/** Níveis aceitos pelo pino. Qualquer outro valor faz o construtor lançar. */
const VALID_LOG_LEVELS = new Set([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

/**
 * Resolve LOG_LEVEL tolerando lixo na ENV.
 *
 * `pino()` LANÇA quando o nível é desconhecido, e `createLogger()` é chamado em import time
 * em vários módulos (ex.: packages/ai/src/llm/fallback.ts:4). Um typo de uma tecla —
 * `LOG_LEVEL==info` no compose vira o valor `"=info"` — derrubava o container inteiro antes
 * de qualquer log útil sair, com um stack trace do pino que não aponta para a causa.
 *
 * Aqui um valor inválido vira aviso e cai para `info`: o operador vê o problema no stdout,
 * com o valor recebido, e o Brain continua de pé.
 */
function resolveLogLevel(): string {
  const raw = process.env.LOG_LEVEL;
  if (raw === undefined || raw.trim() === '') return 'info';

  const normalized = raw.trim().toLowerCase();
  if (VALID_LOG_LEVELS.has(normalized)) return normalized;

  // console.warn e não logger.warn: o logger ainda não existe neste ponto.
  console.warn(
    `[observability] LOG_LEVEL inválido: ${JSON.stringify(raw)} — usando "info". ` +
      `Valores aceitos: ${[...VALID_LOG_LEVELS].join(', ')}`
  );
  return 'info';
}

export function createLogger(context: LogContext = {}) {
  return pino({
    level: resolveLogLevel(),
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
