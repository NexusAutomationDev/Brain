// RAG-02, RAG-03, D-11: createSearchKnowledgeTool — test stubs (Wave 0 / RED)
// Testa tool search_knowledge: formato de retorno [Coleção: X], string vazia, Zod validation
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock drizzle ANTES de qualquer import do módulo a testar
const mockDb = {};

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

// Mock do embedder para createEmbeddings
const mockEmbedQuery = mock(async (_text: string) => Array(1536).fill(0.1));
const mockEmbedder = { embedQuery: mockEmbedQuery };

mock.module("@brain-pkg/ai", () => ({
  createEmbeddings: mock(async () => mockEmbedder),
}));

// Mock de searchKnowledge — controla os resultados retornados
const mockSearchKnowledge = mock(async () => [
  { id: "c1", content: "Conteúdo sobre FAQ item 1.", collection: "faq", chunkIndex: 1, totalChunks: 3, similarity: 0.9 },
  { id: "c2", content: "Manual de uso do produto.", collection: "manual", chunkIndex: 2, totalChunks: 5, similarity: 0.75 },
]);

mock.module("../../rag/search.js", () => ({
  searchKnowledge: mockSearchKnowledge,
}));

// WAVE 0: Import falhará com "Cannot find module" — estado RED esperado
import { createSearchKnowledgeTool } from "../../tools/search-knowledge.js";

describe("createSearchKnowledgeTool (RAG-02, RAG-03, D-11)", () => {
  beforeEach(() => {
    mockSearchKnowledge.mockClear();
    mockEmbedQuery.mockClear();
  });

  describe("tool.name", () => {
    it("tool.name === 'search_knowledge'", () => {
      const tool = createSearchKnowledgeTool({} as never);
      expect(tool.name).toBe("search_knowledge");
    });
  });

  describe("RAG-02: retorno formatado [Coleção: X] chunk N/M", () => {
    it("retorna string formatada com [Coleção: X] quando há resultados", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      const result = await tool.invoke({ query: "como usar o produto?", collections: ["faq"] }) as string;
      expect(typeof result).toBe("string");
      expect(result).toContain("[Coleção:");
    });

    it("retorna string com separador '---' entre chunks", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      const result = await tool.invoke({ query: "informações sobre produto", collections: ["faq", "manual"] }) as string;
      expect(result).toContain("---");
    });

    it("inclui conteúdo do chunk na string retornada", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      const result = await tool.invoke({ query: "FAQ", collections: ["faq"] }) as string;
      expect(result).toContain("Conteúdo sobre FAQ item 1.");
    });
  });

  describe("D-11: string quando array vazio", () => {
    it("retorna string 'Nenhum resultado encontrado...' quando array vazio (D-11)", async () => {
      mockSearchKnowledge.mockImplementationOnce(async () => []);
      const tool = createSearchKnowledgeTool({} as never);
      const result = await tool.invoke({ query: "pergunta sem resultado", collections: ["faq"] }) as string;
      expect(result).toContain("Nenhum resultado encontrado");
    });

    it("não lança exception quando não há resultados (D-11)", async () => {
      mockSearchKnowledge.mockImplementationOnce(async () => []);
      const tool = createSearchKnowledgeTool({} as never);
      await expect(
        tool.invoke({ query: "sem resultados", collections: ["faq"] })
      ).resolves.toBeDefined();
    });
  });

  describe("RAG-03: aceita múltiplas collections", () => {
    it("tool aceita collections array com múltiplos elementos", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      await expect(
        tool.invoke({ query: "busca ampla", collections: ["faq", "manual", "produtos"] })
      ).resolves.toBeDefined();
    });

    it("passa todas as collections para searchKnowledge", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      await tool.invoke({ query: "busca", collections: ["col-a", "col-b"] });
      expect(mockSearchKnowledge).toHaveBeenCalled();
      const callArgs = mockSearchKnowledge.mock.calls[0] as [unknown, unknown, string[], string];
      // Terceiro argumento deve conter as coleções
      const collectionsArg = callArgs[2];
      expect(collectionsArg).toEqual(expect.arrayContaining(["col-a", "col-b"]));
    });
  });

  describe("Zod: validação de schema", () => {
    it("tool rejeita collections: [] (min(1))", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      await expect(
        tool.invoke({ query: "busca", collections: [] })
      ).rejects.toBeDefined();
    });

    it("tool rejeita chamada sem query", async () => {
      const tool = createSearchKnowledgeTool({} as never);
      await expect(
        // @ts-expect-error — testando schema inválido
        tool.invoke({ collections: ["faq"] })
      ).rejects.toBeDefined();
    });
  });
});
