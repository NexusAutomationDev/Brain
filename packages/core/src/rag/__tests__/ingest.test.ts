// RAG-01, RAG-04: POST /api/v1/ingest — test stubs (Wave 0 / RED)
// Testa createIngestApp: auth Bearer, 400 validation, 200 happy path, INSERT metadata (RAG-04), DELETE por collection+model (D-03)
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock drizzle ANTES de qualquer import do módulo a testar
const mockDeleteWhere = mock(async () => []);
const mockInsertValues = mock(async () => []);
const mockDb = {
  delete: mock(() => ({ where: mockDeleteWhere })),
  insert: mock(() => ({ values: mockInsertValues })),
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
    createdAt: "knowledge_chunks.created_at",
    updatedAt: "knowledge_chunks.updated_at",
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

// Mock do embedder retornado por createEmbeddings
const mockEmbedDocuments = mock(async (chunks: string[]) => chunks.map(() => [0.1, 0.2, 0.3]));
const mockEmbedder = { embedDocuments: mockEmbedDocuments };

mock.module("@brain-pkg/ai", () => ({
  createEmbeddings: mock(async () => mockEmbedder),
}));

// WAVE 0: Import falhará com "Cannot find module" — estado RED esperado
import { createIngestApp } from "../../rag/ingest.js";

const INGEST_ENDPOINT = "http://localhost/api/v1/ingest";

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return new Request(INGEST_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/ingest (RAG-01, RAG-04)", () => {
  const ORIGINAL_INGEST_TOKEN = process.env.INGEST_TOKEN;

  beforeEach(() => {
    mockDeleteWhere.mockClear();
    mockInsertValues.mockClear();
    mockDb.delete.mockClear();
    mockDb.insert.mockClear();
    mockEmbedDocuments.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_INGEST_TOKEN === undefined) {
      delete process.env.INGEST_TOKEN;
    } else {
      process.env.INGEST_TOKEN = ORIGINAL_INGEST_TOKEN;
    }
  });

  describe("RAG-01: autenticação Bearer token", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("retorna 401 quando Authorization header está ausente", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(makeRequest({ text: "some text", collection: "faq" }));
      expect(res.status).toBe(401);
    });

    it("retorna 401 com token Bearer incorreto", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "some text", collection: "faq" },
          { Authorization: "Bearer wrong-token" }
        )
      );
      expect(res.status).toBe(401);
    });

    it("retorna 401 sem o prefixo Bearer (token direto)", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "some text", collection: "faq" },
          { Authorization: "secret-ingest-token" }
        )
      );
      expect(res.status).toBe(401);
    });
  });

  describe("RAG-01: falha fechada quando INGEST_TOKEN não configurado", () => {
    it("retorna 503 quando INGEST_TOKEN não está setado", async () => {
      delete process.env.INGEST_TOKEN;
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "some text", collection: "faq" },
          { Authorization: "Bearer any-token" }
        )
      );
      expect(res.status).toBe(503);
    });
  });

  describe("RAG-01: validação de body", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("retorna 400 quando body não tem campo 'text'", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { collection: "faq" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(res.status).toBe(400);
    });

    it("retorna 400 quando body não tem campo 'collection'", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "some text" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(res.status).toBe(400);
    });

    it("retorna 400 quando text é string vazia", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "", collection: "faq" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(res.status).toBe(400);
    });
  });

  describe("RAG-01: happy path — 200 com { status: ok, chunks: N }", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("retorna 200 com body { status: 'ok', chunks: N } em happy path", async () => {
      const app = createIngestApp({} as never);
      const res = await app.fetch(
        makeRequest(
          { text: "Texto de exemplo para ingestão na base de conhecimento.", collection: "faq" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; chunks: number };
      expect(body.status).toBe("ok");
      expect(typeof body.chunks).toBe("number");
      expect(body.chunks).toBeGreaterThan(0);
    });
  });

  describe("RAG-04: metadados de embedding no INSERT", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("INSERT batch registra embeddingModel não-nulo", async () => {
      const app = createIngestApp({} as never);
      await app.fetch(
        makeRequest(
          { text: "Texto para testar metadados de embedding.", collection: "produtos" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      // O mockInsertValues deve ter sido chamado com objetos contendo embeddingModel
      expect(mockInsertValues).toHaveBeenCalled();
      const callArgs = mockInsertValues.mock.calls[0][0] as Array<{ embeddingModel?: string; chunkIndex?: number; totalChunks?: number }>;
      const firstChunk = Array.isArray(callArgs) ? callArgs[0] : callArgs;
      expect(firstChunk.embeddingModel).toBeTruthy();
    });

    it("INSERT batch registra chunkIndex e totalChunks não-nulos", async () => {
      const app = createIngestApp({} as never);
      await app.fetch(
        makeRequest(
          { text: "Texto para testar metadados de chunk index.", collection: "produtos" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(mockInsertValues).toHaveBeenCalled();
      const callArgs = mockInsertValues.mock.calls[0][0] as Array<{ embeddingModel?: string; chunkIndex?: number; totalChunks?: number }>;
      const chunks = Array.isArray(callArgs) ? callArgs : [callArgs];
      expect(chunks[0].chunkIndex).toBeDefined();
      expect(chunks[0].totalChunks).toBeDefined();
    });
  });

  describe("D-03: DELETE filtra por collection AND embeddingModel", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("DELETE é chamado antes do INSERT (re-ingestão)", async () => {
      const app = createIngestApp({} as never);
      await app.fetch(
        makeRequest(
          { text: "Texto para re-ingestão.", collection: "faq" },
          { Authorization: "Bearer secret-ingest-token" }
        )
      );
      expect(mockDb.delete).toHaveBeenCalled();
      // DELETE deve ter sido chamado antes de INSERT
      const deleteCallOrder = mockDb.delete.mock.invocationCallOrder[0];
      const insertCallOrder = mockDb.insert.mock.invocationCallOrder[0];
      expect(deleteCallOrder).toBeLessThan(insertCallOrder);
    });
  });
});
