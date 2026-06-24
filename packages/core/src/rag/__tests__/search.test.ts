// RAG-02, RAG-03, D-03a, D-07, D-08: searchKnowledge — test stubs (Wave 0 / RED)
// Testa busca cosine similarity: filtro por collections, embeddingModel, threshold 0.5, top 5
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock drizzle ANTES de qualquer import do módulo a testar
const mockLimit = mock(async () => [
  { id: "chunk-1", content: "Conteúdo relevante sobre o assunto.", collection: "faq", similarity: 0.85 },
  { id: "chunk-2", content: "Mais informações sobre o tema.", collection: "manual", similarity: 0.72 },
]);

const mockSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => ({
      orderBy: mock(() => ({
        limit: mockLimit,
      })),
    })),
  })),
}));

const mockDb = {
  select: mockSelect,
};

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));

mock.module("@brain-pkg/database", () => ({
  knowledgeChunks: {
    id: "knowledge_chunks.id",
    collection: "knowledge_chunks.collection",
    content: "knowledge_chunks.content",
    embedding: "knowledge_chunks.embedding",
    embeddingModel: "knowledge_chunks.embedding_model",
    chunkIndex: "knowledge_chunks.chunk_index",
    totalChunks: "knowledge_chunks.total_chunks",
  },
}));

mock.module("drizzle-orm", () => ({
  and: mock((...args: unknown[]) => ({ op: "and", args })),
  eq: mock((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  inArray: mock((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  cosineDistance: mock((col: unknown, vec: unknown) => ({ op: "cosineDistance", col, vec })),
  desc: mock((col: unknown) => ({ op: "desc", col })),
  gt: mock((col: unknown, val: unknown) => ({ op: "gt", col, val })),
  sql: mock((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "sql", strings, values })),
}));

// WAVE 0: Import falhará com "Cannot find module" — estado RED esperado
import { searchKnowledge } from "../../rag/search.js";

describe("searchKnowledge (RAG-02, RAG-03, D-03a, D-07, D-08)", () => {
  beforeEach(() => {
    mockLimit.mockClear();
    mockSelect.mockClear();
  });

  describe("RAG-02/RAG-03: filtragem por collections", () => {
    it("executa query no banco quando chamada com collections array", async () => {
      const queryVector = Array(1536).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-3-small");
      expect(mockSelect).toHaveBeenCalled();
    });

    it("usa inArray para filtrar por coleções (RAG-02)", async () => {
      const { inArray } = await import("drizzle-orm");
      const queryVector = Array(1536).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq", "manual"], "text-embedding-3-small");
      // inArray deve ter sido chamado com as collections
      expect(inArray).toHaveBeenCalled();
    });

    it("aceita múltiplas collections no filtro (RAG-03)", async () => {
      const queryVector = Array(1536).fill(0.1);
      const result = await searchKnowledge(
        mockDb as never,
        queryVector,
        ["faq", "manual", "produtos"],
        "text-embedding-3-small"
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("D-03a: filtragem por embeddingModel", () => {
    it("usa eq para filtrar por embeddingModel (D-03a)", async () => {
      const { eq } = await import("drizzle-orm");
      const queryVector = Array(1536).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-3-small");
      // eq deve ter sido chamado — filtra por embeddingModel
      expect(eq).toHaveBeenCalled();
    });

    it("filtra com o embeddingModel passado como argumento", async () => {
      const { eq } = await import("drizzle-orm");
      const queryVector = Array(768).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-004");
      const eqCalls = (eq as ReturnType<typeof mock>).mock.calls as Array<[unknown, unknown]>;
      const embeddingModelCalls = eqCalls.filter(([, val]) => val === "text-embedding-004");
      expect(embeddingModelCalls.length).toBeGreaterThan(0);
    });
  });

  describe("D-08: filtragem por threshold de similaridade (0.5)", () => {
    it("usa gt para filtrar similaridade acima do threshold (D-08)", async () => {
      const { gt } = await import("drizzle-orm");
      const queryVector = Array(1536).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-3-small");
      expect(gt).toHaveBeenCalled();
    });
  });

  describe("D-07: limite de 5 resultados", () => {
    it("aplica .limit(5) na query (D-07)", async () => {
      const queryVector = Array(1536).fill(0.1);
      await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-3-small");
      // mockLimit representa o .limit() call — deve ter sido chamado com 5
      expect(mockLimit).toHaveBeenCalledWith(5);
    });
  });

  describe("retorno", () => {
    it("retorna array de resultados com id, content, collection, similarity", async () => {
      const queryVector = Array(1536).fill(0.1);
      const result = await searchKnowledge(mockDb as never, queryVector, ["faq"], "text-embedding-3-small");
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("id");
        expect(result[0]).toHaveProperty("content");
        expect(result[0]).toHaveProperty("similarity");
      }
    });
  });
});
