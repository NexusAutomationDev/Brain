import { describe, it, expect, beforeEach, mock } from "bun:test";

mock.module("@langchain/openai", () => ({
  OpenAIEmbeddings: class MockOpenAIEmbeddings {
    model: string;
    dimensions?: number;
    constructor(config: { model?: string; openAIApiKey?: string; dimensions?: number }) {
      this.model = config.model ?? "";
      this.dimensions = config.dimensions;
    }
    async embedQuery(_text: string): Promise<number[]> {
      return Array(this.dimensions || 1536).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(this.dimensions || 1536).fill(0.1));
    }
  },
}));

mock.module("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: class MockGoogleEmbeddings {
    model: string;
    constructor(config: { model?: string; apiKey?: string }) {
      this.model = config.model ?? "";
    }
    async embedQuery(_text: string): Promise<number[]> {
      return Array(768).fill(0.1);
    }
  },
  ChatGoogleGenerativeAI: class MockGoogleChat {},
}));

const { createEmbeddings, resolveEmbeddingModel, parseDimensions } = await import("../factory.js");

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

  it("uses EMBEDDING_DIMENSIONS env var (no hardcoded 1536)", () => {
    process.env.EMBEDDING_DIMENSIONS = "10";
    expect(parseDimensions()).toBe(10);
    delete process.env.EMBEDDING_DIMENSIONS;
    expect(parseDimensions()).toBeUndefined();
  });

  describe("D-14/D-17: defaults de modelo por provider (via resolveEmbeddingModel)", () => {
    beforeEach(() => {
      delete process.env.EMBEDDING_MODEL;
      delete process.env.LLM_PROVIDER;
    });

    it("não lança quando EMBEDDING_MODEL está ausente (D-17)", async () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.API_KEY = "test-key";
      await expect(createEmbeddings()).resolves.toBeDefined();
    });

    it("resolve text-embedding-3-small para LLM_PROVIDER=openai (D-14)", () => {
      expect(resolveEmbeddingModel("openai")).toBe("text-embedding-3-small");
    });

    it("resolve text-embedding-3-small para LLM_PROVIDER=openrouter (D-14)", () => {
      expect(resolveEmbeddingModel("openrouter")).toBe("text-embedding-3-small");
    });

    it("resolve text-embedding-004 para LLM_PROVIDER=gemini (D-14)", () => {
      expect(resolveEmbeddingModel("gemini")).toBe("text-embedding-004");
    });

    it("usa openai como provider padrão quando LLM_PROVIDER ausente (D-14)", () => {
      expect(resolveEmbeddingModel()).toBe("text-embedding-3-small");
    });

    it("EMBEDDING_MODEL explícito sobrescreve o default (D-14)", () => {
      process.env.EMBEDDING_MODEL = "text-embedding-ada-002";
      expect(resolveEmbeddingModel("openai")).toBe("text-embedding-ada-002");
    });
  });
});
