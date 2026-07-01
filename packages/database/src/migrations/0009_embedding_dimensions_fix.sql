TRUNCATE TABLE "embeddings", "knowledge_chunks";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" TYPE vector(1536);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1536);
