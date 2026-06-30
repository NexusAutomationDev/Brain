import type { Sql } from 'postgres';

/**
 * D-11/TECH-03: Status snapshot do transport — mirrored from @brain-pkg/transport.
 * Definido localmente para evitar dependência circular:
 * @brain-pkg/transport → @brain-pkg/observability → @brain-pkg/transport (CIRCULAR).
 * Duck typing — qualquer objeto com { type, connected } satisfaz este contrato.
 */
export interface TransportStatus {
  type: 'webhook' | 'rabbitmq';
  connected: boolean;
}

/**
 * D-10/TECH-03: Interface mínima de ITransport usada pelo health check.
 * Definida localmente (duck typing) para evitar dependência circular com @brain-pkg/transport.
 * WebhookTransport e RabbitMQTransport implementam structuralmente este contrato.
 */
export interface ITransportLike {
  getStatus(): TransportStatus;
}

/**
 * Health check result structure per D-13.
 *
 * @property status - Overall system health: 'ok' | 'degraded' | 'error'
 * @property checks - Individual check results
 * @property transport - TransportStatus snapshot (D-15/TECH-03). Omitido quando transport não injetado (backward compat).
 * @property version - Git commit hash or 'unknown' (Claude's discretion: included for debugging)
 * @property timestamp - ISO 8601 timestamp
 *
 * Security note (T-03-02): This response exposes only status and boolean checks.
 * Never include connection strings, usernames, or passwords in health check output.
 * T-27-03-01: TransportStatus contém apenas type e connected — nunca expõe RABBITMQ_URL, credenciais ou stack traces.
 */
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    db: 'connected' | 'failed';
    /**
     * D-15/TECH-03: Status do transport. Omitido quando transport não injetado (backward compat).
     * 'connected' = transport operacional; 'disconnected' = transport em falha/reconexão.
     */
    transport?: 'connected' | 'disconnected';
  };
  /**
   * D-16/TECH-03: TransportStatus completo (type + connected).
   * Omitido quando transport não injetado (backward compat).
   */
  transport?: TransportStatus;
  version?: string;
  timestamp: string;
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
 * OBS-02/TECH-03: Realiza health check completo incluindo status do transport.
 *
 * HTTP status code mapping (D-14/D-16):
 * - 200: status === 'ok' (db + transport ok)
 * - 503: db === 'failed' OU transport === 'disconnected' (qualquer dependência crítica com falha)
 * - 500: status === 'error' (erro interno inesperado)
 *
 * @param sql - postgres.js Sql instance para verificar DB
 * @param transport - ITransportLike opcional; omitido = campo transport ausente do resultado (backward compat)
 */
export async function performHealthCheck(sql: Sql, transport?: ITransportLike): Promise<HealthCheckResult> {
  const dbOk = await checkDatabase(sql);
  const transportStatus = transport?.getStatus();
  const transportOk = transportStatus ? transportStatus.connected : true; // sem transport = não verifica

  // D-16: transport desconectado = 'degraded' (Brain não processa mensagens)
  // db falha = 'error' (mais grave — sem dados)
  const status = !dbOk ? 'error' : !transportOk ? 'degraded' : 'ok';

  return {
    status,
    checks: {
      db: dbOk ? 'connected' : 'failed',
      ...(transportStatus && {
        transport: transportStatus.connected ? 'connected' : 'disconnected',
      }),
    },
    ...(transportStatus && { transport: transportStatus }),
    version: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
  };
}
