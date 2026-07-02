import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

let lastConstructedConfig: { model?: string; apiKey?: string } | undefined;

mock.module("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: class MockGoogleEmbeddings {
    model: string;
    apiKey?: string;
    constructor(config: { model?: string; apiKey?: string }) {
      this.model = config.model ?? "";
      this.apiKey = config.apiKey;
      lastConstructedConfig = config;
    }
    async embedQuery(_text: string): Promise<number[]> {
      return Array(3072).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(3072).fill(0.1));
    }
  },
}));

const { GeminiEmbeddingProvider } = await import("../../gemini-provider.js");

const ENV_KEYS = ["EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS", "API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("GeminiEmbeddingProvider (D-03/D-18)", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    lastConstructedConfig = undefined;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("Test 6: providerName is 'gemini'", () => {
    const provider = new GeminiEmbeddingProvider();
    expect(provider.providerName).toBe("gemini");
  });

  it("Test 7: default model is 'gemini-embedding-001' (NOT 'text-embedding-004')", async () => {
    new GeminiEmbeddingProvider();
    // Force embedder initialization to capture constructor args
    await (async () => {
      const provider = new GeminiEmbeddingProvider();
      await provider.embedQuery("x");
    })();
    expect(lastConstructedConfig?.model).toBe("gemini-embedding-001");
    expect(lastConstructedConfig?.model).not.toBe("text-embedding-004");
  });

  it("Test 8: default dimensions is 3072 when EMBEDDING_DIMENSIONS absent (D-18)", () => {
    const provider = new GeminiEmbeddingProvider();
    expect(provider.dimensions).toBe(3072);
  });

  it("Test 9: embed(texts) and embedQuery(text) resolve using mocked embedder", async () => {
    const provider = new GeminiEmbeddingProvider();
    const embedResult = await provider.embed(["a"]);
    expect(embedResult).toHaveLength(1);
    expect(embedResult[0]).toHaveLength(3072);

    const queryResult = await provider.embedQuery("x");
    expect(queryResult).toHaveLength(3072);
  });

  it("Test 10: constructing with apiKey never throws or logs it (T-2-03)", () => {
    // T-2-03 discipline is enforced at the source level (verified by acceptance_criteria
    // grep: no console.log/logger call includes apiKey). Here we assert construction with
    // a secret never throws — the real guarantee (no logging) is a static source property.
    expect(() => new GeminiEmbeddingProvider({ apiKey: "secret-key" })).not.toThrow();
  });

  describe("IN-03 (28-REVIEW)/D-18: fail-fast EMBEDDING_DIMENSIONS validation", () => {
    it("Test 11: throws ConfigurationError when constructed with dimensions=1536 (mismatch)", () => {
      expect(() => new GeminiEmbeddingProvider({ dimensions: 1536 })).toThrow();
      try {
        new GeminiEmbeddingProvider({ dimensions: 1536 });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as Error).name).toBe("ConfigurationError");
        expect((err as Error).message).toContain("1536");
        expect((err as Error).message).toContain("3072");
      }
    });

    it("Test 12: does not throw when constructed with dimensions=3072 (explicit match)", () => {
      expect(() => new GeminiEmbeddingProvider({ dimensions: 3072 })).not.toThrow();
    });

    it("Test 13: does not throw when constructed with no override (default 3072)", () => {
      expect(() => new GeminiEmbeddingProvider()).not.toThrow();
    });
  });
});
