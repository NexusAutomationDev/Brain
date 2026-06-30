/**
 * TECH-03 / OBS-02: Testes unitários para performHealthCheck() com transport opcional.
 *
 * Usa mocks de ITransport (duck typing) para não depender de instâncias reais.
 * Usa proxy de Sql para simular DB ok/fail sem conexão real.
 */

import { describe, it, expect } from 'bun:test';
import { performHealthCheck } from '../../health.js';
import type { Sql } from 'postgres';

// Sql proxy que simula SELECT 1 com sucesso.
// O target precisa ser uma função para que tagged template call (sql`SELECT 1`) funcione via Proxy.apply.
function makeSqlOk(): Sql {
  const fn = (..._args: unknown[]) => Promise.resolve([{ '?column?': 1 }]);
  return new Proxy(fn as unknown as Sql, {
    apply: () => Promise.resolve([{ '?column?': 1 }]),
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      return (..._args: unknown[]) => Promise.resolve([{ '?column?': 1 }]);
    },
  });
}

// Sql proxy que simula falha de conexão
function makeSqlFail(): Sql {
  const fn = (..._args: unknown[]) => Promise.reject(new Error('DB unreachable'));
  return new Proxy(fn as unknown as Sql, {
    apply: () => Promise.reject(new Error('DB unreachable')),
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      return (..._args: unknown[]) => Promise.reject(new Error('DB unreachable'));
    },
  });
}

// Transport stubs (duck typing — sem import de @brain-pkg/transport)
const webhookTransportStub = {
  getStatus: () => ({ type: 'webhook' as const, connected: true }),
  start: async () => {},
  stop: async () => {},
};

const rabbitConnectedStub = {
  getStatus: () => ({ type: 'rabbitmq' as const, connected: true }),
  start: async () => {},
  stop: async () => {},
};

const rabbitDisconnectedStub = {
  getStatus: () => ({ type: 'rabbitmq' as const, connected: false }),
  start: async () => {},
  stop: async () => {},
};

describe('performHealthCheck() com transport', () => {
  it('Test 1: performHealthCheck(sql, undefined) → resultado sem campo transport (backward compat)', async () => {
    const result = await performHealthCheck(makeSqlOk(), undefined);
    expect(result.transport).toBeUndefined();
    expect(result.checks.transport).toBeUndefined();
    expect(result.status).toBe('ok');
  });

  it('Test 2: performHealthCheck(sql, webhookTransport) → result.transport = { type: webhook, connected: true }; status ok', async () => {
    const result = await performHealthCheck(makeSqlOk(), webhookTransportStub);
    expect(result.transport).toEqual({ type: 'webhook', connected: true });
    expect(result.checks.transport).toBe('connected');
    expect(result.status).toBe('ok');
  });

  it('Test 3: performHealthCheck(sql, rabbitMQ disconnected) + db ok → status degraded, checks.transport = disconnected', async () => {
    const result = await performHealthCheck(makeSqlOk(), rabbitDisconnectedStub);
    expect(result.status).toBe('degraded');
    expect(result.checks.transport).toBe('disconnected');
    expect(result.transport).toEqual({ type: 'rabbitmq', connected: false });
  });

  it('Test 4: performHealthCheck(sql, rabbitMQ connected) + db ok → status ok, checks.transport = connected', async () => {
    const result = await performHealthCheck(makeSqlOk(), rabbitConnectedStub);
    expect(result.status).toBe('ok');
    expect(result.checks.transport).toBe('connected');
    expect(result.transport).toEqual({ type: 'rabbitmq', connected: true });
  });

  it('Test 5: performHealthCheck(sql, transport) + db failed → status error', async () => {
    const result = await performHealthCheck(makeSqlFail(), webhookTransportStub);
    expect(result.status).toBe('error');
    expect(result.checks.db).toBe('failed');
  });
});
