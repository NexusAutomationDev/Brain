import { pgTable, text, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { vector } from 'pgvector/drizzle-orm';

// DB-02: Read dimension from env — must be locked before first migration.
// WARNING: Cannot be changed after first migration without re-embedding all data.
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

// Validate dimension range to catch misconfiguration early (T-02-02)
if (EMBEDDING_DIM < 128 || EMBEDDING_DIM > 4096) {
  throw new Error(
    `Invalid EMBEDDING_DIMENSIONS: ${EMBEDDING_DIM}. Must be between 128 and 4096.`
  );
}

// DB-01: Users table — maps external identity to internal UUID
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: text('external_id').notNull().unique(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// DB-01: Memories table — key/value store for long-term agent memory
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userKeyIdx: index('memories_user_key_idx').on(table.userId, table.key),
}));

// DB-01: Agent state table — persists LangGraph checkpoint state per thread
export const agentState = pgTable('agent_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: text('thread_id').notNull().unique(),
  checkpoint: jsonb('checkpoint').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// DB-01 + DB-02: Embeddings table — semantic memory with PGVector HNSW index
export const embeddings = pgTable('embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  content: text('content').notNull(),
  // DB-02: Dimension from EMBEDDING_DIMENSIONS env (default 1536 for OpenAI text-embedding-3-small)
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // HNSW index for fast cosine similarity search (m=16, ef_construction=64 are production defaults)
  embeddingIdx: index('embeddings_embedding_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 }),
  sessionIdx: index('embeddings_session_idx').on(table.sessionId),
}));
