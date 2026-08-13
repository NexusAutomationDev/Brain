// Integration test: runBrainSeed() idempotency across all three brain types, against a
// real PostgreSQL instance. Mirrors brain-runner.integration.test.ts's describeOrSkip /
// TEST_DB_URL gating convention and cleanup-by-filter pattern exactly.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runBrainSeed } from '../../seed.js';

// Test configuration
const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;

// Skip all integration tests gracefully when DB not available (avoids crashing unit test runs).
// Precondition: this test is a no-op, not a failure, in any environment without a real test
// database configured — expected in most local/CI runs.
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

const SEEDS_DIR = join(import.meta.dir, '../../seeds');

// Synthetic brainType values that will not collide with real seeded data (sdr/support/echo)
// already present in the test database from normal app usage/other tests.
const REAL_TYPES = ['sdr', 'support', 'echo'] as const;

describeOrSkip('runBrainSeed() idempotency across brain types (SEED-04)', () => {
  let sql: ReturnType<typeof postgres>;
  let fixturesRoot: string;
  // Real seed content is literal SQL (brain_type baked in at build time, no runtime
  // parameterization inside runBrainSeed() — see seed.ts). To exercise runBrainSeed() with a
  // synthetic, collision-free brainType while still reading the real seeds/<type> file
  // content (no mocking), each real file is copied into a temp fixture directory with its
  // brain_type literal swapped from e.g. 'sdr' to 'seed-idem-sdr'. This keeps the assertions
  // faithful to the real, production seed shape for every brain type without ever touching
  // real sdr/support/echo rows in the test database.
  const cases: { brainType: string; folder: string }[] = [];

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL as string, { prepare: false });
    fixturesRoot = await mkdtemp(join(tmpdir(), 'seed-idempotency-test-'));

    for (const realType of REAL_TYPES) {
      const syntheticType = `seed-idem-${realType}`;
      const realFilePath = join(SEEDS_DIR, realType, '0001_fup_defaults.sql');
      const realContent = await readFile(realFilePath, 'utf-8');
      const syntheticContent = realContent.split(`'${realType}'`).join(`'${syntheticType}'`);

      const folder = join(fixturesRoot, syntheticType);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, '0001_fup_defaults.sql'), syntheticContent);

      cases.push({ brainType: syntheticType, folder });
    }
  });

  afterAll(async () => {
    // Cleanup rows created for all three synthetic brainTypes.
    for (const { brainType } of cases) {
      await sql`DELETE FROM fup_config WHERE brain_type = ${brainType}`;
      await sql`DELETE FROM prompts WHERE brain_type = ${brainType} AND key = 'fup'`;
    }
    await sql.end();
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  test('all three brain types: runBrainSeed() called twice does not throw or duplicate rows', async () => {
    for (const { brainType, folder } of cases) {
      await expect(runBrainSeed(sql, brainType, folder)).resolves.toBeUndefined();
      await expect(runBrainSeed(sql, brainType, folder)).resolves.toBeUndefined();

      const fupConfigRows = await sql`
        SELECT COUNT(*)::int AS count FROM fup_config WHERE brain_type = ${brainType}
      `;
      expect(fupConfigRows[0]?.count).toBe(1);

      const fupPromptRows = await sql`
        SELECT COUNT(*)::int AS count FROM prompts WHERE brain_type = ${brainType} AND key = 'fup'
      `;
      expect(fupPromptRows[0]?.count).toBe(1);
    }
  }, 30000);
});
