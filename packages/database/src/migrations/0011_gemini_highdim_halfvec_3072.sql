-- ============================================================================
-- GEMINI / HIGH-DIMENSION EMBEDDING FLAVOR — NOT PART OF THE STANDARD BUILD
-- ============================================================================
-- Generated via `EMBEDDING_DIMENSIONS=3072 drizzle-kit generate` — Gemini's
-- gemini-embedding-001 always outputs 3072 dimensions (see
-- packages/embeddings/src/gemini-provider.ts). pgvector caps HNSW/IVFFlat
-- indexes at 2000 dimensions for the `vector` type, so this migration converts
-- embeddings.embedding and knowledge_chunks.embedding to halfvec(3072)
-- (half-precision, pgvector >= 0.7.0; HNSW supported up to 4000 dims;
-- confirmed against pgvector 0.8.2 in dev).
--
-- CRITICAL — DO NOT SHIP THIS FILE IN THE STANDARD brain-sdr:1.5 IMAGE:
-- apps/brain-sdr/Dockerfile currently does
-- `COPY packages/database/src/migrations ./migrations` (the entire folder),
-- and runMigrations() applies every migration registered in
-- meta/_journal.json unconditionally on every boot. If this file is present
-- when that image is rebuilt, EXISTING 1536/OpenAI tenants sharing that image
-- will have embeddings/knowledge_chunks TRUNCATED and force-converted to
-- halfvec(3072) on next deploy — silent data loss, not a crash. A future
-- Gemini/high-dim brain-sdr image variant must use a build step that
-- includes this file while the STANDARD image build explicitly excludes it.
-- This is deferred ops/build work — NOT done as part of this fix.
--
-- DEV-WORKFLOW GOTCHA: because this migration is registered in the same
-- linear meta/_journal.json timeline used by the standard 1536 flavor, any
-- FUTURE `bun run db:generate` in this package run with the default
-- EMBEDDING_DIMENSIONS (1536) will treat this halfvec(3072) state as the new
-- baseline and silently propose a migration reverting embeddings/
-- knowledge_chunks back to vector(1536) (confirmed empirically). Regenerate
-- with EMBEDDING_DIMENSIONS=3072 for unrelated schema changes, or manually
-- inspect/discard any spurious vector(1536) revert diff before committing.
--
-- drizzle-kit generate omits TRUNCATE (same limitation documented in
-- 0009_embedding_dimensions_fix.sql) — added by hand below, same pattern.
-- ============================================================================
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
DROP INDEX "embeddings_embedding_idx";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(3072);
--> statement-breakpoint
CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m=16,ef_construction=64);
