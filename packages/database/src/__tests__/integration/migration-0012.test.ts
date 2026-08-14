import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');
const SQL_FILE = join(MIGRATIONS_DIR, '0012_agents_dblink_handoff_context.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta/_journal.json');
const TABLES_FILE = join(import.meta.dir, '../../schema/tables.ts');

describe('Migration 0012_agents_dblink_handoff_context — scaffold (HANDOFF-01/02)', () => {
  it('journal contém entry idx=12 com tag 0012_agents_dblink_handoff_context', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf-8'));
    const entry = journal.entries.find(
      (e: { tag: string }) => e.tag === '0012_agents_dblink_handoff_context'
    );
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(12);
  });

  it('arquivo SQL 0012_agents_dblink_handoff_context.sql existe', () => {
    expect(existsSync(SQL_FILE)).toBe(true);
  });

  it('SQL cria extensão dblink, tabela agents e coluna handoff_context, nessa ordem', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    const expectedFragments = [
      'CREATE EXTENSION IF NOT EXISTS dblink',
      'CREATE TABLE "agents"',
      '"brain_type"',
      '"connection_string"',
      '"enabled"',
      'ALTER TABLE "leads" ADD COLUMN "handoff_context"',
    ];

    let lastIndex = -1;
    for (const fragment of expectedFragments) {
      expect(sql).toContain(fragment);
      const idx = sql.indexOf(fragment);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('tables.ts exporta agents', () => {
    const source = readFileSync(TABLES_FILE, 'utf-8');
    expect(source).toContain('export const agents');
  });

  it('tables.ts exporta handoffContext em leads', () => {
    const source = readFileSync(TABLES_FILE, 'utf-8');
    expect(source).toContain('handoffContext');
  });
});
