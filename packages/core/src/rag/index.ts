// RAG barrel export — exports públicos do módulo packages/core/src/rag/
export { splitText } from "./chunker.js";
export { searchKnowledge, resolveEmbeddingModel } from "./search.js";
export type { ChunkResult } from "./search.js";
export { createIngestApp } from "./ingest.js";
