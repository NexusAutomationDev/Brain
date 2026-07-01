-- EMBEDDING_DIMENSIONS hardcoded to 1536 (OpenAI text-embedding-3-small default).
-- Regenerating this migration for a different dimension (e.g., Gemini's 3072) requires
-- manually re-adding the TRUNCATE statements below — drizzle-kit generate will omit them.
-- See .planning/phases/28-embedding-sdk/28-VERIFICATION.md for accepted override rationale (EMBD-03).
TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);
