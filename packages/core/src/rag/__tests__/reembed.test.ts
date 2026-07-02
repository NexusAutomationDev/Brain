// D-16: POST /api/v1/reembed — testa createReembedApp: auth Bearer, validação de body,
// paginação, filtro ne(embeddingModel), Pitfall 3 guard (vetores vazios não são gravados)
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock drizzle ANTES de qualquer import do módulo a testar
const mockLimit = mock(() => ({ offset: mockOffset }));
function mockOffset() {
  return offsetImpl();
}
let offsetImpl: () => Promise<Array<{ id: string; content: string; embeddingModel: string }>> =
  async () => [];

const mockWhere = mock(() => ({ limit: mockLimit }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

const mockUpdateWhere = mock(async () => []);
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }));
const mockUpdate = mock(() => ({ set: mockUpdateSet }));

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
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
  ne: mock((col: unknown, val: unknown) => ({ op: "ne", col, val })),
  inArray: mock((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
  cosineDistance: mock((col: unknown, vec: unknown) => ({ op: "cosineDistance", col, vec })),
  desc: mock((col: unknown) => ({ op: "desc", col })),
  gt: mock((col: unknown, val: unknown) => ({ op: "gt", col, val })),
  sql: mock((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "sql", strings, values })),
}));

// Mock do IEmbeddingProvider injetado — plain object satisfazendo a interface (D-02)
const mockEmbed = mock(async (contents: string[]) => contents.map(() => [0.1, 0.2, 0.3]));
const mockEmbeddingProvider = {
  embed: mockEmbed,
  embedQuery: mock(async (_text: string) => [0.1, 0.2, 0.3]),
  dimensions: 3,
  providerName: "openai",
};

import { createReembedApp } from "../../rag/reembed.js";

const REEMBED_ENDPOINT = "http://localhost/api/v1/reembed";

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(REEMBED_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeRow(id: string, content = "chunk content", embeddingModel = "gemini") {
  return { id, content, embeddingModel };
}

describe("POST /api/v1/reembed (D-16)", () => {
  const ORIGINAL_INGEST_TOKEN = process.env.INGEST_TOKEN;

  beforeEach(() => {
    mockSelect.mockClear();
    mockFrom.mockClear();
    mockWhere.mockClear();
    mockLimit.mockClear();
    mockUpdate.mockClear();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockEmbed.mockClear();
    mockEmbed.mockImplementation(async (contents: string[]) => contents.map(() => [0.1, 0.2, 0.3]));
    offsetImpl = async () => [];
  });

  afterEach(() => {
    if (ORIGINAL_INGEST_TOKEN === undefined) {
      delete process.env.INGEST_TOKEN;
    } else {
      process.env.INGEST_TOKEN = ORIGINAL_INGEST_TOKEN;
    }
  });

  describe("Test 1: fail-closed quando INGEST_TOKEN não configurado", () => {
    it("retorna 503 quando INGEST_TOKEN não está setado", async () => {
      delete process.env.INGEST_TOKEN;
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer any-token" })
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Service unavailable — reembed endpoint not configured");
    });
  });

  describe("Test 2: autenticação Bearer token", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("retorna 401 quando Authorization header está ausente", async () => {
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(makeRequest({ collection: "faq" }));
      expect(res.status).toBe(401);
    });

    it("retorna 401 com token Bearer incorreto", async () => {
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer wrong-token" })
      );
      expect(res.status).toBe(401);
    });

    it("retorna 401 sem o prefixo Bearer (token direto)", async () => {
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "secret-ingest-token" })
      );
      expect(res.status).toBe(401);
    });
  });

  describe("Test 3: validação de body — collection obrigatório", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("retorna 400 quando body não tem campo 'collection'", async () => {
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({}, { Authorization: "Bearer secret-ingest-token" })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe(
        "Bad Request — field 'collection' is required and must be a non-empty string"
      );
    });

    it("retorna 400 quando collection é string vazia", async () => {
      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "  " }, { Authorization: "Bearer secret-ingest-token" })
      );
      expect(res.status).toBe(400);
    });
  });

  describe("Test 4: happy path — seleciona por collection + ne(embeddingModel), embeda e atualiza", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("chama embed() com os conteúdos da página e update() uma vez por linha embedada com sucesso", async () => {
      let call = 0;
      offsetImpl = async () => {
        call++;
        if (call === 1) {
          return [makeRow("id-1", "content 1"), makeRow("id-2", "content 2")];
        }
        return [];
      };

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; collection: string; updated: number; skipped: number };
      expect(body.status).toBe("ok");
      expect(body.collection).toBe("faq");
      expect(body.updated).toBe(2);
      expect(body.skipped).toBe(0);

      expect(mockEmbed).toHaveBeenCalledWith(["content 1", "content 2"]);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: [0.1, 0.2, 0.3],
          embeddingModel: "openai",
        })
      );
    });
  });

  describe("Test 5: paginação — offset avança por PAGE_SIZE, loop termina em página vazia", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("emite exatamente 2 SELECTs quando primeira página retorna PAGE_SIZE linhas e segunda retorna 0", async () => {
      const PAGE_SIZE = 200;
      const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(`id-${i}`, `content ${i}`));
      let call = 0;
      const offsetsSeen: number[] = [];

      // Wrap mockLimit/mockOffset to capture offset arg
      const originalMockOffset = mockLimit.getMockImplementation();
      mockLimit.mockImplementation(() => ({
        offset: (offsetArg: number) => {
          offsetsSeen.push(offsetArg);
          call++;
          if (call === 1) return Promise.resolve(fullPage);
          return Promise.resolve([]);
        },
      }));

      mockEmbed.mockImplementation(async (contents: string[]) => contents.map(() => [0.1, 0.2, 0.3]));

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      expect(mockSelect).toHaveBeenCalledTimes(2);
      expect(offsetsSeen).toEqual([0, PAGE_SIZE]);

      // restore
      if (originalMockOffset) mockLimit.mockImplementation(originalMockOffset);
    });
  });

  describe("Test 6 (Pitfall 3 guard): vetores de comprimento zero são pulados, não gravados", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("apenas linhas com vetores válidos são atualizadas; linhas com vetor vazio são puladas e logadas", async () => {
      let call = 0;
      offsetImpl = async () => {
        call++;
        if (call === 1) {
          return [makeRow("id-1", "content 1"), makeRow("id-2", "content 2"), makeRow("id-3", "content 3")];
        }
        return [];
      };

      mockEmbed.mockImplementationOnce(async (contents: string[]) =>
        contents.map((_, i) => (i === 1 ? [] : [0.1, 0.2, 0.3]))
      );

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { updated: number; skipped: number };
      expect(body.updated).toBe(2);
      expect(body.skipped).toBe(1);
      // update() called only for the 2 valid rows, not the skipped one
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe("Test 7: response body reporta counts agregados de todas as páginas", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("agrega updated/skipped através de múltiplas páginas", async () => {
      let call = 0;
      offsetImpl = async () => {
        call++;
        if (call === 1) return [makeRow("id-1"), makeRow("id-2")];
        if (call === 2) return [makeRow("id-3")];
        return [];
      };

      mockEmbed.mockImplementation(async (contents: string[]) => {
        if (contents.length === 2) return [[0.1, 0.2, 0.3], []];
        return contents.map(() => [0.1, 0.2, 0.3]);
      });

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { updated: number; skipped: number };
      // Page 1: 1 updated, 1 skipped. Page 2: 1 updated. Totals: updated=2, skipped=1
      expect(body.updated).toBe(2);
      expect(body.skipped).toBe(1);
    });
  });

  describe("Test 8: filtro ne(embeddingModel) — idempotência (verifica uso do filtro, não infra real)", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("constrói o WHERE com eq(collection) e ne(embeddingModel, providerName)", async () => {
      offsetImpl = async () => [];

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(mockWhere).toHaveBeenCalled();
      const whereArg = mockWhere.mock.calls[0][0] as { op: string; args: Array<{ op: string; val: unknown }> };
      expect(whereArg.op).toBe("and");
      const neClause = whereArg.args.find((a) => a.op === "ne");
      expect(neClause).toBeDefined();
      expect(neClause?.val).toBe("openai");
    });
  });

  describe("Test 9 (D-06/WR-03): MAX_PAGES cap interrompe loop em tabela unbounded/runaway", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("interrompe o loop após exatamente MAX_PAGES=500 SELECTs e retorna truncated:true", async () => {
      const PAGE_SIZE = 200;
      const MAX_PAGES = 500;
      // Mock que sempre retorna uma página cheia — simula tabela unbounded/runaway
      const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(`id-${i}`, `content ${i}`));

      const originalMockOffset = mockLimit.getMockImplementation();
      mockLimit.mockImplementation(() => ({
        offset: () => Promise.resolve(fullPage),
      }));

      mockEmbed.mockImplementation(async (contents: string[]) => contents.map(() => [0.1, 0.2, 0.3]));

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      // Loop nunca vê rows.length === 0 — só para via MAX_PAGES cap
      expect(mockSelect).toHaveBeenCalledTimes(MAX_PAGES);
      const body = (await res.json()) as { updated: number; skipped: number; truncated: boolean };
      expect(body.truncated).toBe(true);
      expect(body.updated).toBe(MAX_PAGES * PAGE_SIZE);

      // restore
      if (originalMockOffset) mockLimit.mockImplementation(originalMockOffset);
    });
  });

  describe("Test 10: dataset pequeno (< MAX_PAGES * PAGE_SIZE) completa normalmente sem truncated", () => {
    beforeEach(() => {
      process.env.INGEST_TOKEN = "secret-ingest-token";
    });

    it("processa 3 páginas e termina via rows.length===0 antes do cap, truncated:false", async () => {
      const PAGE_SIZE = 200;
      let call = 0;
      const pages = [
        Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(`p1-${i}`)),
        Array.from({ length: PAGE_SIZE }, (_, i) => makeRow(`p2-${i}`)),
        Array.from({ length: 50 }, (_, i) => makeRow(`p3-${i}`)),
      ];

      const originalMockOffset = mockLimit.getMockImplementation();
      mockLimit.mockImplementation(() => ({
        offset: () => {
          const page = pages[call] ?? [];
          call++;
          return Promise.resolve(page);
        },
      }));

      mockEmbed.mockImplementation(async (contents: string[]) => contents.map(() => [0.1, 0.2, 0.3]));

      const app = createReembedApp({} as never, mockEmbeddingProvider as never);
      const res = await app.fetch(
        makeRequest({ collection: "faq" }, { Authorization: "Bearer secret-ingest-token" })
      );

      expect(res.status).toBe(200);
      // 3 páginas com dados + 1 página vazia final = 4 SELECTs, bem abaixo de MAX_PAGES=500
      expect(mockSelect).toHaveBeenCalledTimes(4);
      const body = (await res.json()) as { updated: number; skipped: number; truncated: boolean };
      expect(body.updated).toBe(PAGE_SIZE + PAGE_SIZE + 50);
      expect(body.truncated).toBe(false);

      // restore
      if (originalMockOffset) mockLimit.mockImplementation(originalMockOffset);
    });
  });
});
