// RAG-01: POST /api/v1/ingest — ingestão de texto na base de conhecimento
// D-05: createIngestApp(sql) exportada de @brain-pkg/core e montada explicitamente no server.ts de cada Brain
// D-13: Authorization: Bearer <INGEST_TOKEN> — fail-closed (503) se INGEST_TOKEN não configurado
// D-03: Re-ingestão = DELETE WHERE collection AND embedding_model = current + INSERT batch
// RAG-04: INSERT registra embeddingModel, chunkIndex, totalChunks como metadados não-nulos
// Security T-21-02-02: limite de payload 1MB para prevenir DoS de memória/CPU no chunking
// Security T-21-02-04: INGEST_TOKEN nunca logado — apenas presença/ausência
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { knowledgeChunks } from "@brain-pkg/database";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import { createLogger } from "@brain-pkg/observability";
import type { Sql } from "postgres";
import { splitText } from "./chunker.js";

const logger = createLogger();
const MAX_TEXT_BYTES = 1_000_000; // T-21-02-02: 1MB max — DoS mitigation

/**
 * D-05: Cria sub-app Hono para ingestão de texto na base de conhecimento RAG.
 *
 * Segurança: Bearer token via INGEST_TOKEN ENV. Fail-closed (503) se não configurado.
 * Sem dependência em BrainRunner — recebe sql direto (como createHealthApp).
 *
 * @param sql - postgres.js Sql instance do tenant
 * @param embeddingProvider - IEmbeddingProvider injetado (D-02: substitui createEmbeddings())
 */
export function createIngestApp(sql: Sql, embeddingProvider: IEmbeddingProvider): Hono {
  const app = new Hono();

  app.post("/api/v1/ingest", async (c) => {
    const ingestToken = process.env.INGEST_TOKEN;

    // D-13: Fail-closed — INGEST_TOKEN não configurado → 503
    // T-21-02-04: apenas logar presença/ausência, nunca o valor
    if (!ingestToken) {
      logger.warn({}, "/api/v1/ingest called but INGEST_TOKEN env var is not set");
      return c.json({ error: "Service unavailable — ingest endpoint not configured" }, 503);
    }

    // D-13: Bearer token — "Authorization: Bearer <token>"
    // Exige prefixo "Bearer " explícito — token direto sem prefixo é rejeitado
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== ingestToken) {
      logger.warn({}, "/api/v1/ingest unauthorized attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Body parsing — catch JSON inválido
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return c.json({ error: "Bad Request — field 'text' is required and must be a non-empty string" }, 400);
    }
    if (typeof body.collection !== "string" || !body.collection.trim()) {
      return c.json({ error: "Bad Request — field 'collection' is required and must be a non-empty string" }, 400);
    }

    // T-21-02-02: Limite de tamanho de payload
    const textBytes = Buffer.byteLength(body.text, "utf8");
    if (textBytes > MAX_TEXT_BYTES) {
      return c.json({ error: "Payload Too Large — text exceeds 1MB limit" }, 413);
    }

    const { text, collection } = body as { text: string; collection: string };

    // D-14/D-15/D-17: modelo de embedding sourced diretamente do provider injetado
    const embeddingModel = embeddingProvider.providerName;

    // D-02: Chunk recursivo do texto
    const chunks = await splitText(text);

    // D-16: EMBEDDING_DIMENSIONS=768 garante compatibilidade OpenAI/Gemini na mesma coluna pgvector.
    // embeddingProvider já lê EMBEDDING_DIMENSIONS automaticamente via createEmbeddingProvider().
    // Sem código adicional necessário aqui — compatibilidade é responsabilidade do operador
    // configurar EMBEDDING_DIMENSIONS=768 quando usar múltiplos providers na mesma coleção.
    // Gerar embeddings em batch
    const vectors = await embeddingProvider.embed(chunks);

    // Pitfall 3 guard: Gemini's embedDocuments() pode retornar vetor vazio por chunk em
    // falha parcial silenciosa. Filtramos os índices válidos antes de persistir.
    const validIndices = vectors
      .map((v, i) => (v.length > 0 ? i : -1))
      .filter((i) => i !== -1);
    if (validIndices.length === 0) {
      logger.warn(
        { collection, totalChunks: chunks.length },
        "Embedding failed for all chunks"
      );
      return c.json({ error: "Embedding failed for all chunks" }, 502);
    }
    if (validIndices.length < chunks.length) {
      logger.warn(
        {
          collection,
          failed: chunks.length - validIndices.length,
          succeeded: validIndices.length,
        },
        "Some chunks failed to embed — inserting only successfully embedded chunks"
      );
    }

    const db = drizzle(sql);

    // D-03: DELETE chunks do modelo atual nessa coleção (preserva chunks de outros modelos)
    // T-21-02-05: DELETE usa dois filtros obrigatórios — collection E embeddingModel
    await db
      .delete(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.collection, collection),
          eq(knowledgeChunks.embeddingModel, embeddingModel)
        )
      );

    // RAG-04: INSERT batch com metadados obrigatórios não-nulos (apenas chunks válidos)
    const rows = validIndices.map((i, idx) => ({
      collection,
      content: chunks[i],
      embedding: vectors[i],
      embeddingModel,               // D-15: modelo gravado em cada chunk
      chunkIndex: idx,              // RAG-04: índice do chunk (0-based, entre os válidos)
      totalChunks: validIndices.length, // RAG-04: total de chunks persistidos
      updatedAt: new Date(),
    }));
    await db.insert(knowledgeChunks).values(rows);

    logger.info({ collection, chunks: rows.length, embeddingModel }, "RAG ingest complete");
    return c.json({ status: "ok", chunks: rows.length });
  });

  return app;
}
