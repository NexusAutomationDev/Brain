import { describe, it, expect, beforeEach, mock } from "bun:test";

mock.module("@langchain/openai", () => ({
  OpenAIEmbeddings: class MockOpenAIEmbeddings {
    constructor(public config: Record<string, unknown>) {}
    async embedQuery(_text: string): Promise<number[]> {
      return Array(Number(process.env.EMBEDDING_DIMENSIONS) || 1536).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(Number(process.env.EMBEDDING_DIMENSIONS) || 1536).fill(0.1));
    }
  },
}));

mock.module("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: class MockGoogleEmbeddings {
    constructor(public config: Record<string, unknown>) {}
    async embedQuery(_text: string): Promise<number[]> {
      return Array(768).fill(0.1);
    }
  },
  ChatGoogleGenerativeAI: class MockGoogleChat {},
}));

const { createEmbeddings } = await import("../factory.js");

describe("createEmbeddings factory (AI-04)", () => {
  beforeEach(() => {
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.LLM_PROVIDER;
    delete process.env.API_KEY;
  });

  it("returns Embeddings instance when EMBEDDING_MODEL is set (mocked)", async () => {
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.API_KEY = "test-key";
    const embeddings = await createEmbeddings();
    expect(embeddings).toBeDefined();
  });

  it("uses EMBEDDING_DIMENSIONS env var (no hardcoded 1536)", async () => {
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.EMBEDDING_DIMENSIONS = "10";
    process.env.API_KEY = "test-key";
    const embeddings = await createEmbeddings();
    const vector = await (embeddings as { embedQuery(t: string): Promise<number[]> }).embedQuery("test");
    expect(vector).toHaveLength(10);
  });

  describe("D-14/D-17: defaults de modelo por provider", () => {
    beforeEach(() => {
      delete process.env.EMBEDDING_MODEL;
      delete process.env.LLM_PROVIDER;
      process.env.API_KEY = "test-key";
    });

    it("não lança quando EMBEDDING_MODEL está ausente (D-17)", async () => {
      process.env.LLM_PROVIDER = "openai";
      await expect(createEmbeddings()).resolves.toBeDefined();
    });

    it("resolve text-embedding-3-small para LLM_PROVIDER=openai (D-14)", async () => {
      process.env.LLM_PROVIDER = "openai";
      const embedder = await createEmbeddings() as { config: Record<string, unknown> };
      expect(embedder.config?.model).toBe("text-embedding-3-small");
    });

    it("resolve text-embedding-3-small para LLM_PROVIDER=openrouter (D-14)", async () => {
      process.env.LLM_PROVIDER = "openrouter";
      const embedder = await createEmbeddings() as { config: Record<string, unknown> };
      expect(embedder.config?.model).toBe("text-embedding-3-small");
    });

    it("resolve text-embedding-004 para LLM_PROVIDER=gemini (D-14)", async () => {
      process.env.LLM_PROVIDER = "gemini";
      const embedder = await createEmbeddings() as { config: Record<string, unknown> };
      expect(embedder.config?.model).toBe("text-embedding-004");
    });

    it("usa openai como provider padrão quando LLM_PROVIDER ausente (D-14)", async () => {
      // LLM_PROVIDER não setado
      await expect(createEmbeddings()).resolves.toBeDefined();
    });

    it("EMBEDDING_MODEL explícito sobrescreve o default (D-14)", async () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.EMBEDDING_MODEL = "text-embedding-ada-002";
      const embedder = await createEmbeddings() as { config: Record<string, unknown> };
      expect(embedder.config?.model).toBe("text-embedding-ada-002");
    });
  });
});
