import { pgTable, text, uuid, timestamp, jsonb, boolean, index, vector, uniqueIndex } from 'drizzle-orm/pg-core';

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
  userKeyIdx: uniqueIndex('memories_user_key_idx').on(table.userId, table.key),
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

// SDK-04: Prompts table — stores all brain prompts keyed by (brain_type, key).
// D-11: Schema with id, brain_type, key, content, created_at, updated_at.
// D-08: UNIQUE constraint on (brain_type, key) — sub-agents are separate brain_types.
// D-09: No version column in v1 — direct UPDATE, history via git.
// D-10: No locale column in v1 — i18n is v2.
export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  brainType: text('brain_type').notNull(),
  key: text('key').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brainTypeKeyIdx: uniqueIndex('prompts_brain_type_key_idx').on(table.brainType, table.key),
}));

// LEAD-01: Leads table — identity and state for each lead (D-01 to D-08)
// D-08: aditiva — tabela users NÃO é removida em v1.1
export const leads = pgTable('leads', {
  // D-01: UUID PK
  id: uuid('id').primaryKey().defaultRandom(),
  // D-02: IDLead do payload — chave de vínculo com thread_id do PostgresSaver
  uniqueId: text('unique_id').notNull(),
  // D-03: Nome nullable — primeira mensagem pode não incluir nome
  nome: text('nome'),
  // D-04: Numero NOT NULL + UNIQUE — chave de upsert para identificação do lead
  numero: text('numero').notNull(),
  // D-05: ia_ativada DEFAULT true — desativação é ação manual explícita
  iaAtivada: boolean('ia_ativada').notNull().default(true),
  // D-06: fullpp nullable — flag "follow up IA", sem regra de negócio em v1.1
  fullpp: boolean('fullpp'),
  // D-07: timestamps padrão
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // D-04: UNIQUE constraint em numero — chave de upsert para Phase 7
  numeroIdx: uniqueIndex('leads_numero_unique_idx').on(table.numero),
}));
