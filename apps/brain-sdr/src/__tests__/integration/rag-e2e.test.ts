// SC-3 (Phase 23): Teste de integração RAG end-to-end
// Confirma que createSearchKnowledgeTool(sql) conecta ao banco e retorna chunks relevantes.
// Requer PostgreSQL com pgvector — pular por padrão se DATABASE_URL não estiver configurado.
//
// Para executar: DATABASE_URL=postgres://... bun test rag-e2e.test.ts

import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { cosineDistance, desc, gt, and, sql as drizzleSql, inArray, eq } from "drizzle-orm";
import { knowledgeChunks } from "@brain-pkg/database";
import { createSearchKnowledgeTool } from "@brain-pkg/core";

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_RAG = !!DATABASE_URL;

const TEST_COLLECTION = `rag_e2e_test_${Date.now()}`;
const TEST_MODEL = "text-embedding-test-model";
const TEST_CONTENT = "Brain SDR é um agente de vendas especializado em qualificação de leads.";

let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let insertedId: string | null = null;
// Detectado em beforeAll a partir do catálogo pgvector — não depende de env var
let UNIT_VECTOR: number[] = [];

describe("RAG E2E — integração com banco real (SC-3, Phase 23)", () => {
  beforeAll(async () => {
    if (!RUN_RAG) return;
    sql = postgres(DATABASE_URL!);
    db = drizzle(sql);

    // Detectar dimensão real da coluna embedding no banco — robusto a qualquer EMBEDDING_DIMENSIONS
    const [dimRow] = await sql<[{ atttypmod: number }]>`
      SELECT a.atttypmod
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relname = 'knowledge_chunks'
        AND a.attname = 'embedding'
        AND n.nspname = 'public'
    `;
    const actualDim = dimRow?.atttypmod ?? 1536;
    // Vetor unitário com 1.0 na dimensão 0 — similaridade cosine = 1.0 consigo mesmo
    UNIT_VECTOR = Array.from({ length: actualDim }, (_, i) => (i === 0 ? 1.0 : 0.0));

    // Inserir chunk de teste com vetor conhecido — sem chamar embedder real
    const [row] = await db
      .insert(knowledgeChunks)
      .values({
        collection: TEST_COLLECTION,
        content: TEST_CONTENT,
        embedding: UNIT_VECTOR as any,
        embeddingModel: TEST_MODEL,
        chunkIndex: 0,
        totalChunks: 1,
      })
      .returning({ id: knowledgeChunks.id });
    insertedId = row.id;
  });

  afterAll(async () => {
    if (!db || !sql) return;
    if (insertedId) {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.id, insertedId));
    }
    await sql.end();
  });

  // Busca direta no banco com vetor idêntico ao inserido (sem embedder)
  // Confirma que o path DB → chunks funciona corretamente
  test.skipIf(!RUN_RAG)(
    "Drizzle encontra chunk pelo vetor exato inserido (path DB puro, sem embedder)",
    async () => {
      const similarity = drizzleSql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, UNIT_VECTOR)})`;
      const results = await db!
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
            inArray(knowledgeChunks.collection, [TEST_COLLECTION]),
            eq(knowledgeChunks.embeddingModel, TEST_MODEL),
            gt(similarity, 0.5)
          )
        )
        .orderBy(desc(similarity))
        .limit(5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("Brain SDR");
      expect(results[0].similarity).toBeGreaterThan(0.99);
    }
  );

  // searchFn injeta busca real com vetor conhecido — testa a tool sem chamar embedder
  test.skipIf(!RUN_RAG)(
    "createSearchKnowledgeTool(sql) com searchFn retorna chunks do banco real (RAG-02)",
    async () => {
      // searchFn usa o vetor conhecido para consultar o banco real
      const realSearchFn = async (): Promise<any[]> => {
        const similarity = drizzleSql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, UNIT_VECTOR)})`;
        return db!
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
              inArray(knowledgeChunks.collection, [TEST_COLLECTION]),
              eq(knowledgeChunks.embeddingModel, TEST_MODEL),
              gt(similarity, 0.5)
            )
          )
          .orderBy(desc(similarity))
          .limit(5);
      };

      const tool = createSearchKnowledgeTool(sql!, realSearchFn);
      const result = await tool.invoke({ query: "agente SDR", collections: [TEST_COLLECTION] });

      expect(typeof result).toBe("string");
      expect(result).toContain("Brain SDR");
      // D-10: formato "[Coleção: X] chunk N/M"
      expect(result).toContain(`[Coleção: ${TEST_COLLECTION}]`);
      expect(result).toContain("chunk 1/1");
    }
  );

  test.skipIf(!RUN_RAG)(
    "createSearchKnowledgeTool retorna fallback quando coleção não existe (D-11)",
    async () => {
      const emptyFn = async (): Promise<any[]> => [];
      const tool = createSearchKnowledgeTool(sql!, emptyFn);
      const result = await tool.invoke({ query: "query qualquer", collections: ["inexistente"] });
      expect(result).toBe("Nenhum resultado encontrado para a consulta nas coleções informadas.");
    }
  );

  // Smoke test sem banco — confirma que a factory não lança na instanciação (RAG-02 wiring)
  test("createSearchKnowledgeTool(fakeSql) instancia sem erros (smoke test sem banco)", () => {
    const fakeSql = {} as any;
    expect(() => createSearchKnowledgeTool(fakeSql)).not.toThrow();
    const tool = createSearchKnowledgeTool(fakeSql);
    expect(tool.name).toBe("search_knowledge");
  });
});
