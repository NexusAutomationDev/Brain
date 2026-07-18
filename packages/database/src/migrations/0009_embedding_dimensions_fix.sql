-- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Regenerating this migration for a different dimension (e.g., Gemini's 3072) requires
-- manually re-adding the TRUNCATE statements below — drizzle-kit generate will omit them.
-- See .planning/phases/28-embedding-sdk/28-VERIFICATION.md for accepted override rationale (EMBD-03).
--
-- For dimensions > 2000 (e.g. Gemini's fixed 3072), pgvector's HNSW/IVFFlat
-- index cap forces a different column type — see
-- 0011_gemini_highdim_halfvec_3072.sql, which converts to halfvec(3072)
-- instead of vector(N). That file is NOT part of the standard brain-sdr:1.5
-- (1536/OpenAI) image build — see its header comment for the full rationale
-- and the required build-time exclusion for future Gemini/high-dim image
-- variants.
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);
