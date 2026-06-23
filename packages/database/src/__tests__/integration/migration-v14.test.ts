import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dir, '../../migrations');
const SQL_FILE = join(MIGRATIONS_DIR, '0007_v1_4_foundation.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta/_journal.json');
const TABLES_FILE = join(import.meta.dir, '../../schema/tables.ts');

describe('Migration 0007_v1_4_foundation — scaffold (FUP-04)', () => {
  it('journal contém entry idx=7 com tag 0007_v1_4_foundation', () => {
    const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf-8'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0007_v1_4_foundation');
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(7);
  });

  it('arquivo SQL 0007_v1_4_foundation.sql existe', () => {
    expect(existsSync(SQL_FILE)).toBe(true);
  });

  it('SQL cria tabela knowledge_chunks', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('CREATE TABLE "knowledge_chunks"');
  });

  it('SQL cria tabela fup_config', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('CREATE TABLE "fup_config"');
  });

  it('SQL adiciona coluna fup_enabled em leads', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('"fup_enabled"');
  });

  it('SQL adiciona coluna fup_step em leads', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('"fup_step"');
  });

  it('SQL adiciona coluna fup_next_at em leads', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('"fup_next_at"');
  });

  it('SQL adiciona coluna last_message_at em leads', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('"last_message_at"');
  });

  it('SQL usa vector(1536) para embedding em knowledge_chunks', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('vector(1536)');
  });

  it('SQL usa integer[] para intervals_seconds em fup_config', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('integer[]');
  });

  it('SQL usa text[] para allowed_days em fup_config', () => {
    const sql = readFileSync(SQL_FILE, 'utf-8');
    expect(sql).toContain('text[]');
  });

  it('tables.ts exporta knowledgeChunks', () => {
    const source = readFileSync(TABLES_FILE, 'utf-8');
    expect(source).toContain('export const knowledgeChunks');
  });

  it('tables.ts exporta fupConfig', () => {
    const source = readFileSync(TABLES_FILE, 'utf-8');
    expect(source).toContain('export const fupConfig');
  });
});
