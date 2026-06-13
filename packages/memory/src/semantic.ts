import { cosineDistance, desc, gt, eq, and, sql } from "drizzle-orm";
import { embeddings } from "@brain-pkg/database";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger({ brainId: "memory" });

/**
 * MEM-03: Input shape for embedding upsert.
 */
export interface EmbeddingInput {
  userId: string;
  sessionId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

/**
 * MEM-03: Fire-and-forget embedding upsert.
 *
 * Inserts an embedding vector into the `embeddings` table.
 * Uses fire-and-forget pattern: errors are logged but DO NOT propagate to the caller.
 * This prevents embedding failures from blocking agent turn processing.
 *
 * @param db - Drizzle database instance
 * @param input - Embedding data including userId, sessionId, content, vector, metadata
 */
export function upsertEmbedding(db: PostgresJsDatabase, input: EmbeddingInput): void {
  // Fire-and-forget: intentionally not awaited
  db.insert(embeddings)
    .values({
      userId: input.userId,
      sessionId: input.sessionId,
      content: input.content,
      embedding: input.embedding, // pgvector accepts number[] via drizzle-orm/pg-core vector type
      metadata: input.metadata ?? {},
    })
    .catch((err) => {
      // Log but do not rethrow — MEM-03 fire-and-forget contract
      logger.error({ err, userId: input.userId }, "upsertEmbedding failed");
    });
}

/**
 * MEM-03: Cosine similarity search using HNSW index.
 *
 * Returns top-K embeddings nearest to the query vector.
 * Uses drizzle-orm's cosineDistance function — type-safe, HNSW index path guaranteed.
 *
 * Security (T-2-05-03): WHERE clause includes userId isolation to prevent
 * cross-user result leakage — each user can only retrieve their own embeddings.
 *
 * @param db - Drizzle database instance
 * @param userId - Filter by userId for tenant isolation
 * @param queryVector - Query vector (must match EMBEDDING_DIMENSIONS)
 * @param topK - Number of results to return (default: 3)
 * @param threshold - Minimum cosine similarity (default: 0.1)
 */
export async function searchSimilar(
  db: PostgresJsDatabase,
  userId: string,
  queryVector: number[],
  topK = 3,
  threshold = 0.1
): Promise<Array<{ id: string; content: string; similarity: number }>> {
  const similarity = sql<number>`1 - (${cosineDistance(embeddings.embedding, queryVector)})`;

  return db
    .select({
      id: embeddings.id,
      content: embeddings.content,
      similarity,
    })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.userId, userId),
        gt(similarity, threshold)
      )
    )
    .orderBy(desc(similarity))
    .limit(topK);
}
