/**
 * EMBD-01: Provider-agnostic embedding contract.
 * Any provider (OpenAI, Gemini, future adapters) implements this shape.
 *
 * D-20: embed() for batch/ingest-time embedding (search-knowledge.ts's ingest path uses
 * this), embedQuery() for single-text/query-time embedding (search path) — these are
 * NOT interchangeable at every call site because some providers use different task-type
 * semantics for query vs. document embedding.
 */
export interface IEmbeddingProvider {
  /** Batch embedding for documents/chunks (ingest-time). */
  embed(texts: string[]): Promise<number[][]>;
  /** Single-text embedding for queries (search-time). */
  embedQuery(text: string): Promise<number[]>;
  /** Vector dimension this provider produces — must match the DB's vector(N) column. */
  readonly dimensions: number;
  /** Provider identifier — persisted as knowledge_chunks.embedding_model (D-17 filter key). */
  readonly providerName: string;
}
