import { describe, it, expect } from 'bun:test';
import { users, memories, agentState, embeddings, prompts } from './tables.js';

// Helper: get the Drizzle table name via its well-known symbol
function tableName(table: Record<symbol, unknown>): string {
  return table[Symbol.for('drizzle:Name')] as string;
}

describe('Schema Tables (DB-01, DB-02, SDK-04)', () => {
  describe('DB-01: Schema defines all required tables', () => {
    it('exports users table with uuid id and externalId unique constraint', () => {
      expect(users).toBeDefined();
      expect(tableName(users as any)).toBe('users');
      expect(users.id.columnType).toBe('PgUUID');
      expect(users.id.primary).toBe(true);
      expect(users.externalId.name).toBe('external_id');
      expect(users.externalId.isUnique).toBe(true);
      expect(users.externalId.notNull).toBe(true);
    });

    it('exports memories table with userId and key columns', () => {
      expect(memories).toBeDefined();
      expect(tableName(memories as any)).toBe('memories');
      expect(memories.userId.name).toBe('user_id');
      expect(memories.userId.notNull).toBe(true);
      expect(memories.key.name).toBe('key');
      expect(memories.key.notNull).toBe(true);
    });

    it('exports agentState table with threadId unique constraint', () => {
      expect(agentState).toBeDefined();
      expect(tableName(agentState as any)).toBe('agent_state');
      expect(agentState.threadId.name).toBe('thread_id');
      expect(agentState.threadId.isUnique).toBe(true);
      expect(agentState.threadId.notNull).toBe(true);
    });

    it('exports embeddings table with vector column', () => {
      expect(embeddings).toBeDefined();
      expect(tableName(embeddings as any)).toBe('embeddings');
      expect(embeddings.embedding.name).toBe('embedding');
      expect(embeddings.embedding.notNull).toBe(true);
    });
  });

  describe('DB-02: PGVector configuration', () => {
    it('embeddings table reads EMBEDDING_DIMENSIONS from env (DB-02)', () => {
      // In test env (.env.test), EMBEDDING_DIMENSIONS=128
      // In production env (.env), EMBEDDING_DIMENSIONS=1536
      // The table must accept the configured value — valid range is 128–4096
      const dimensions = (embeddings.embedding as any).config?.dimensions ?? (embeddings.embedding as any).dimensions;
      expect(typeof dimensions).toBe('number');
      expect(dimensions).toBeGreaterThanOrEqual(128);
      expect(dimensions).toBeLessThanOrEqual(4096);
    });

    it('embeddings table has HNSW index defined via extra config builder', () => {
      // The HNSW index is defined in the extra config builder symbol
      const extraConfigBuilder = (embeddings as any)[Symbol.for('drizzle:ExtraConfigBuilder')];
      expect(extraConfigBuilder).toBeDefined();
      expect(typeof extraConfigBuilder).toBe('function');
      // The config string should contain hnsw reference
      const configStr = extraConfigBuilder.toString();
      expect(configStr).toContain('hnsw');
    });
  });

  describe('SDK-04: Prompts table — stores brain prompts keyed by (brain_type, key)', () => {
    it('exports prompts table', () => {
      expect(prompts).toBeDefined();
      expect(tableName(prompts as any)).toBe('prompts');
    });

    it('prompts table has id column as UUID primary key', () => {
      expect(prompts.id.name).toBe('id');
      expect(prompts.id.columnType).toBe('PgUUID');
      expect(prompts.id.primary).toBe(true);
    });

    it('prompts table has brainType column mapped to brain_type (NOT NULL)', () => {
      expect(prompts.brainType.name).toBe('brain_type');
      expect(prompts.brainType.notNull).toBe(true);
    });

    it('prompts table has key column (NOT NULL)', () => {
      expect(prompts.key.name).toBe('key');
      expect(prompts.key.notNull).toBe(true);
    });

    it('prompts table has content column (NOT NULL)', () => {
      expect(prompts.content.name).toBe('content');
      expect(prompts.content.notNull).toBe(true);
    });

    it('prompts table has createdAt column mapped to created_at', () => {
      expect(prompts.createdAt.name).toBe('created_at');
    });

    it('prompts table has updatedAt column mapped to updated_at', () => {
      expect(prompts.updatedAt.name).toBe('updated_at');
    });

    it('prompts table has a uniqueIndex defined on (brainType, key) — D-08', () => {
      // The extra config builder must reference uniqueIndex for (brainType, key)
      const extraConfigBuilder = (prompts as any)[Symbol.for('drizzle:ExtraConfigBuilder')];
      expect(extraConfigBuilder).toBeDefined();
      expect(typeof extraConfigBuilder).toBe('function');
      const configStr = extraConfigBuilder.toString();
      expect(configStr).toContain('uniqueIndex');
      expect(configStr).toContain('prompts_brain_type_key_idx');
    });
  });
});
