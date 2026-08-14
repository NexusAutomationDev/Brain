// Unit test: getAgentConnection() — HANDOFF-04's three-way not_found/disabled/ok contract,
// against a mocked drizzle-orm/postgres-js module (no live DB needed).
// Mirrors packages/database/src/__tests__/unit/seed.test.ts's mockSql pattern (simpler here:
// no sql.begin()/tx needed, getAgentConnection() does a single SELECT).
import { describe, it, expect, beforeEach, mock } from 'bun:test';

let selectResult: unknown[] = [];

// drizzle(sql).select().from(agents).where(...).limit(1) chain — mock at the drizzle level.
mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResult,
        }),
      }),
    }),
  }),
}));

// Import AFTER mock.module() — bun's hoisting requirement, same convention as seed.test.ts.
import { getAgentConnection } from '../../agents.js';

describe('getAgentConnection() — HANDOFF-04', () => {
  beforeEach(() => {
    selectResult = [];
  });

  it('nome desconhecido retorna {ok:false, reason:"not_found"}', async () => {
    selectResult = [];
    const result = await getAgentConnection({} as never, 'unknown-agent');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('nome com enabled=false retorna {ok:false, reason:"disabled"}', async () => {
    selectResult = [
      { name: 'support', brainType: 'support', connectionString: 'host=x', enabled: false },
    ];
    const result = await getAgentConnection({} as never, 'support');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('nome válido e enabled=true retorna connectionString + brainType', async () => {
    selectResult = [
      { name: 'support', brainType: 'support', connectionString: 'host=x dbname=y', enabled: true },
    ];
    const result = await getAgentConnection({} as never, 'support');
    expect(result).toEqual({ ok: true, connectionString: 'host=x dbname=y', brainType: 'support' });
  });
});
