// RAG-02/RAG-03/D-03a/D-07/D-08: Cosine similarity search em knowledge_chunks
// Adaptado de packages/memory/src/semantic.ts — troca userId/embeddings por collection/knowledgeChunks
import { cosineDistance, desc, gt, and, sql, inArray, eq } from "drizzle-orm";
import { knowledgeChunks } from "@brain-pkg/database";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * D-15: Metadados de resultado de chunk para formatação (D-10)
 */
export interface ChunkResult {
  id: string;
  content: string;
  collection: string;
  chunkIndex: number;
  totalChunks: number;
  similarity: number;
}

/**
 * RAG-02/RAG-03: Busca cosine similarity em múltiplas coleções.
 *
 * D-03a: Filtra por embeddingModel = modelo atual — chunks de modelos antigos ignorados.
 * D-07: Retorna top 5 global (sem limite por coleção).
 * D-08: Threshold de similaridade cosine: 0.5.
 *
 * ANTI-PATTERN: search.ts recebe queryVector já calculado — não chama embedder aqui.
 * A conversão query→vector é responsabilidade de createSearchKnowledgeTool.
 *
 * T-21-02-06: Guard collections vazias antes do inArray — evita query inválida com inArray([]).
 *
 * @param db - Drizzle database instance
 * @param queryVector - Vetor da query já calculado via embedder.embedQuery()
 * @param collections - Array de coleções (mínimo 1 — validado no schema Zod da tool)
 * @param embeddingModel - Modelo atual, sourced de IEmbeddingProvider.providerName (D-17)
 * @param topK - Máximo de resultados (default: 5 — D-07)
 * @param threshold - Mínimo de similaridade (default: 0.5 — D-08)
 */
export async function searchKnowledge(
  db: PostgresJsDatabase,
  queryVector: number[],
  collections: string[],
  embeddingModel: string,
  topK = 5,
  threshold = 0.5
): Promise<ChunkResult[]> {
  // T-21-02-06: guard collections vazias antes do inArray
  if (collections.length === 0) return [];

  const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryVector)})`;

  return db
    .select({
      id: knowledgeChunks.id,
      content: knowledgeChunks.content,
      collection: knowledgeChunks.collection,
      chunkIndex: knowledgeChunks.chunkIndex,
      totalChunks: knowledgeChunks.totalChunks,
      similarity,
    })
    .from(knowledgeChunks)
    .where(
      and(
        inArray(knowledgeChunks.collection, collections), // RAG-03: multi-coleção
        eq(knowledgeChunks.embeddingModel, embeddingModel), // D-03a: filtrar modelo atual
        gt(similarity, threshold) // D-08: threshold 0.5
      )
    )
    .orderBy(desc(similarity)) // RAG-03: ordenar por score global
    .limit(topK); // D-07: top 5 global
}
