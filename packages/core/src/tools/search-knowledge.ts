// RAG-02/RAG-03: search_knowledge tool — factory seguindo padrão de createPauseSessionTool
// D-06: Factory function com closure sobre sql — compatibilidade multi-tenant
// D-07: Top 5 chunks no total (hardcoded — D-09: LLM não configura)
// D-08: Threshold cosine 0.5 (hardcoded — D-09)
// D-09: topK e threshold não expostos no schema Zod da tool
// D-10: Resultado formatado em blocos "[Coleção: X] chunk N/M\nconteúdo"
// D-11: Sem resultados → string fixa, sem throw

import { tool } from "@langchain/core/tools";
import { drizzle } from "drizzle-orm/postgres-js";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import type { Sql } from "postgres";
import { z } from "zod";
import { searchKnowledge } from "../rag/search.js";
import type { ChunkResult } from "../rag/search.js";

// D-11: String constante para "sem resultados" — testável por igualdade exata
const NO_RESULTS_MSG =
  "Nenhum resultado encontrado para a consulta nas coleções informadas.";

/**
 * D-10: Formata resultados de chunks em blocos legíveis pelo LLM.
 * Formato: "[Coleção: {collection}] chunk {chunkIndex+1}/{totalChunks}\n{content}"
 * Separador entre chunks: "\n---\n"
 */
// IN-02 (28-REVIEW): defensive cap on per-chunk content length in the LLM-facing tool
// output. Chunks from the standard ingest path (chunker.ts CHUNK_SIZE=1000) never hit
// this, but rows written by other paths (manual DB edits, future ingestion code) could
// exceed it — this prevents a single oversized chunk from blowing up LLM context budget.
const MAX_CHUNK_DISPLAY_CHARS = 2000;

function truncateContent(content: string): string {
  if (content.length <= MAX_CHUNK_DISPLAY_CHARS) return content;
  return `${content.slice(0, MAX_CHUNK_DISPLAY_CHARS)}... [truncated]`;
}

function formatResults(results: ChunkResult[]): string {
  return results
    .map(
      (r) =>
        `[Coleção: ${r.collection}] chunk ${r.chunkIndex + 1}/${r.totalChunks}\n${truncateContent(r.content)}`
    )
    .join("\n---\n");
}

/**
 * D-06: Cria a tool search_knowledge bound ao sql do tenant.
 *
 * RAG-02: Gera embedding da query e busca chunks similares no pgvector.
 * RAG-03: Aceita array de coleções e busca em todas simultaneamente.
 * Anti-pattern evitado: embedding da query ocorre AQUI (não em search.ts) — separação de concerns.
 *
 * @param sql - postgres.js Sql instance do tenant (de BrainBuildContext.sql)
 * @param embeddingProvider - IEmbeddingProvider injetado (D-02: substitui createEmbeddings())
 * @param searchFn - override de searchKnowledge para testes (opcional)
 */
export function createSearchKnowledgeTool(
  sql: Sql,
  embeddingProvider: IEmbeddingProvider,
  searchFn: typeof searchKnowledge = searchKnowledge
) {
  const db = drizzle(sql);
  return tool(
    async (args: { query: string; collections: string[] }) => {
      // Pitfall 3: guard collections vazio (schema Zod garante min(1), mas guard defensivo)
      if (!args.collections || args.collections.length === 0) {
        return NO_RESULTS_MSG;
      }

      // Gerar embedding da query (Pitfall 1: usar embedQuery, não embed)
      const queryVector = await embeddingProvider.embedQuery(args.query);

      // D-07/D-08/D-09: topK=5 e threshold=0.5 hardcoded — LLM não controla
      // D-17: providerName do embeddingProvider injetado (não resolveEmbeddingModel())
      const results = await searchFn(
        db,
        queryVector,
        args.collections,
        embeddingProvider.providerName
      );

      if (results.length === 0) {
        return NO_RESULTS_MSG; // D-11: sem throw, retorna string fixa
      }

      return formatResults(results); // D-10: blocos formatados
    },
    {
      name: "search_knowledge",
      description:
        "Busca contexto relevante na base de conhecimento. Use quando precisar de informações sobre produtos, FAQs, manuais ou qualquer conteúdo ingerido nas coleções disponíveis.",
      schema: z.object({
        query: z.string().min(1).describe("Texto da busca semântica"),
        // D-09: collections é o único parâmetro configurável pelo LLM
        collections: z
          .array(z.string().min(1))
          .min(1) // Pitfall 3: min(1) — rejeita array vazio
          .describe("Lista de coleções para buscar (mínimo 1)"),
      }),
    }
  );
}
