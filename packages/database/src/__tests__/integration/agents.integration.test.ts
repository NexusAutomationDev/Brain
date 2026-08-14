// Integration test: getAgentConnection() against a real PostgreSQL instance — HANDOFF-04.
// Mirrors packages/database/src/__tests__/integration/seed-idempotency.test.ts's
// describeOrSkip / TEST_DATABASE_URL gating convention and cleanup-by-filter idiom.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { getAgentConnection } from '../../agents.js';

const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;

// Skip all integration tests gracefully when DB not available (avoids crashing unit test runs).
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

describeOrSkip('getAgentConnection() — integration (HANDOFF-04)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL as string, { prepare: false });
    await sql`INSERT INTO agents (name, brain_type, connection_string, enabled)
      VALUES ('test-agent-enabled', 'support', 'host=x dbname=y', true)
      ON CONFLICT (name) DO NOTHING`;
    await sql`INSERT INTO agents (name, brain_type, connection_string, enabled)
      VALUES ('test-agent-disabled', 'support', 'host=x dbname=y', false)
      ON CONFLICT (name) DO NOTHING`;
  });

  afterAll(async () => {
    await sql`DELETE FROM agents WHERE name IN ('test-agent-enabled', 'test-agent-disabled')`;
    await sql.end();
  });

  test('nome inexistente → not_found', async () => {
    const result = await getAgentConnection(sql, 'does-not-exist');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('nome disabled → disabled', async () => {
    const result = await getAgentConnection(sql, 'test-agent-disabled');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  test('nome válido e enabled → connectionString + brainType', async () => {
    const result = await getAgentConnection(sql, 'test-agent-enabled');
    expect(result).toEqual({ ok: true, connectionString: 'host=x dbname=y', brainType: 'support' });
  });
});
