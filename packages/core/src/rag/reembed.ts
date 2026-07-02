// D-16: POST /api/v1/reembed — batch re-embed tool for knowledge_chunks
// Reuses INGEST_TOKEN Bearer-auth fail-closed pattern from ingest.ts (D-13) — no new auth.
// D-17: collection is a required, explicit parameter — never implicitly "all rows"
// (Tampering / cross-collection mixing prevention).
// Pitfall 3: GoogleGenerativeAIEmbeddings.embedDocuments() silently returns [] per-batch
// on partial failure — this tool detects and skips those rows without writing empty vectors.
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, ne } from "drizzle-orm";
import { knowledgeChunks } from "@brain-pkg/database";
import { createLogger } from "@brain-pkg/observability";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import type { Sql } from "postgres";

const logger = createLogger();
const PAGE_SIZE = 200; // conservative — under OpenAI batchSize=512 and Gemini maxBatchSize=100
// D-06/WR-03: hard ceiling on pagination — PAGE_SIZE=200 * MAX_PAGES=500 = 100k row ceiling per
// POST /api/v1/reembed call. Prevents a single call from becoming an unbounded/runaway job if a
// `collection` filter unexpectedly matches most of the table. Re-invoke the endpoint (same
// `collection`) to resume — rows already re-embedded are skipped by the `ne(embeddingModel, ...)`
// filter on the next call.
const MAX_PAGES = 500;

/**
 * D-16: Cria sub-app Hono para re-embedding em batch de knowledge_chunks existentes.
 *
 * Reprocessa embeddings usando o IEmbeddingProvider atualmente configurado, sem exigir
 * re-ingestão dos documentos originais (o texto do chunk já está preservado na tabela).
 * Escopo obrigatório por `collection` (D-17) — nunca processa implicitamente todas as linhas.
 *
 * Segurança: reusa exatamente o mesmo padrão Bearer/INGEST_TOKEN fail-closed do ingest.ts —
 * não é um novo mecanismo de autenticação.
 *
 * @param sql - postgres.js Sql instance do tenant
 * @param embeddingProvider - IEmbeddingProvider injetado
 */
export function createReembedApp(sql: Sql, embeddingProvider: IEmbeddingProvider): Hono {
  const app = new Hono();

  app.post("/api/v1/reembed", async (c) => {
    const ingestToken = process.env.INGEST_TOKEN;

    // D-13: Fail-closed — INGEST_TOKEN não configurado → 503
    if (!ingestToken) {
      logger.warn({}, "/api/v1/reembed called but INGEST_TOKEN env var is not set");
      return c.json({ error: "Service unavailable — reembed endpoint not configured" }, 503);
    }

    // D-13: Bearer token — "Authorization: Bearer <token>"
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== ingestToken) {
      logger.warn({}, "/api/v1/reembed unauthorized attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Body parsing — catch JSON inválido
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.collection !== "string" || !body.collection.trim()) {
      return c.json(
        { error: "Bad Request — field 'collection' is required and must be a non-empty string" },
        400
      );
    }
    const { collection } = body as { collection: string };

    const db = drizzle(sql);
    let offset = 0;
    let updated = 0;
    let skipped = 0;
    let pages = 0;
    let truncated = false;

    for (;;) {
      const rows = await db
        .select()
        .from(knowledgeChunks)
        .where(
          and(
            eq(knowledgeChunks.collection, collection),
            ne(knowledgeChunks.embeddingModel, embeddingProvider.providerName)
          )
        )
        .limit(PAGE_SIZE)
        .offset(offset);

      if (rows.length === 0) break;

      const vectors = await embeddingProvider.embed(rows.map((r) => r.content));

      for (let i = 0; i < rows.length; i++) {
        if (vectors[i].length === 0) {
          // Pitfall 3: skip silently-failed rows — do NOT write an empty vector,
          // do NOT change embeddingModel (row remains eligible for a future retry)
          skipped++;
          continue;
        }
        await db
          .update(knowledgeChunks)
          .set({
            embedding: vectors[i],
            embeddingModel: embeddingProvider.providerName,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeChunks.id, rows[i].id));
        updated++;
      }

      offset += PAGE_SIZE;
      pages++;
      if (pages >= MAX_PAGES) {
        truncated = true;
        logger.warn(
          { collection, pages, MAX_PAGES, updated, skipped },
          "Re-embed hit MAX_PAGES cap — stopping early. Re-invoke with the same collection to resume."
        );
        break;
      }
    }

    logger.info(
      { collection, updated, skipped, truncated, providerName: embeddingProvider.providerName },
      "Re-embed complete"
    );
    return c.json({ status: "ok", collection, updated, skipped, truncated });
  });

  return app;
}
