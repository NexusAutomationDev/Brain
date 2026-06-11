import { describe, it, expect } from 'bun:test';

describe('Schema Tables (DB-01, DB-02)', () => {
  describe('DB-01: Schema defines all required tables', () => {
    it.todo('exports users table with uuid id and externalId unique constraint');
    it.todo('exports memories table with userId and key index');
    it.todo('exports agentState table with threadId unique constraint');
    it.todo('exports embeddings table with vector column');
  });

  describe('DB-02: PGVector configuration', () => {
    it.todo('embeddings table reads EMBEDDING_DIMENSIONS from env');
    it.todo('embeddings table defaults to 1536 if env not set');
    it.todo('embeddings table has HNSW index with m=16, ef_construction=64');
  });
});
