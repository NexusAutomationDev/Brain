import { pgTable, text, uuid, timestamp, jsonb, boolean, index, vector, uniqueIndex, integer } from 'drizzle-orm/pg-core';

// DB-02: Read dimension from env — must be locked before first migration.
// WARNING: Cannot be changed after first migration without re-embedding all data.
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

// Validate dimension range to catch misconfiguration early (T-02-02)
if (EMBEDDING_DIM < 128 || EMBEDDING_DIM > 4096) {
  throw new Error(
    `Invalid EMBEDDING_DIMENSIONS: ${EMBEDDING_DIM}. Must be between 128 and 4096.`
  );
}

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
  // IDdeal e IDcontato — integração CRM (nullable, sem regra de negócio em v1)
  idDeal: text('id_deal'),
  idContato: text('id_contato'),
  // D-07: timestamps padrão
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // FUP-04: Colunas de estado de FUP por lead (D-10, D-11)
  // fup_enabled e fup_step têm defaults válidos — NOT NULL
  // fup_next_at e last_message_at são nullable — leads existentes não têm esses valores
  fupEnabled: boolean('fup_enabled').notNull().default(false),
  fupStep: integer('fup_step').notNull().default(0),
  fupNextAt: timestamp('fup_next_at', { withTimezone: true }),      // nullable por design
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }), // nullable por design (D-11)
  // FUP-08: Contador de falhas de envio de FUP — persistente no banco (D-14)
  // Incrementado a cada falha de LLM ou transport. Reset a cada FUP bem-sucedido.
  // Quando >= 3 (MAX_FUP_FAILURES): fup_enabled setado para false automaticamente.
  fupFailureCount: integer('fup_failure_count').notNull().default(0),
}, (table) => ({
  // D-04: UNIQUE constraint em numero — chave de upsert para Phase 7
  numeroIdx: uniqueIndex('leads_numero_unique_idx').on(table.numero),
}));

// RAG-04: knowledge_chunks — base de conhecimento semântica para RAG (D-07, D-08, D-09)
// Separada de embeddings: concerns diferentes (RAG vs memória de conversa)
// D-09: Sem índice HNSW — criado manualmente pós-ingestão em produção
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  collection: text('collection').notNull(),
  content: text('content').notNull(),
  // D-08: Mesma dimensão que embeddings — EMBEDDING_DIM do ENV
  embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
  embeddingModel: text('embedding_model').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  totalChunks: integer('total_chunks').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// FUP-01: fup_config — configuração de follow-up por brain_type (D-01 a D-06, D-16)
// D-02: brain_type como text PK — desvio consciente de UUID padrão; simplifica upsert por tipo
// D-16: enabled para controle sem deletar config; scheduler filtra WHERE enabled = true
export const fupConfig = pgTable('fup_config', {
  // D-02: text PK — sem UUID separado
  brainType: text('brain_type').primaryKey(),
  // D-16: ativação por brain_type sem deletar intervalos/horários
  enabled: boolean('enabled').notNull().default(true),
  // D-03: integer[] — ex: [3600, 86400, 259200] = steps em segundos
  intervalsSeconds: integer('intervals_seconds').array().notNull(),
  // D-06: hora do dia 0–23
  minHour: integer('min_hour').notNull(),
  maxHour: integer('max_hour').notNull(),
  // D-04: ex: ['mon','tue','wed','thu','fri']
  allowedDays: text('allowed_days').array().notNull(),
  // D-05: IANA timezone string — ex: 'America/Sao_Paulo'
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
