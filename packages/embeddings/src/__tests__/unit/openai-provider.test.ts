import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

mock.module("@langchain/openai", () => ({
  OpenAIEmbeddings: class MockOpenAIEmbeddings {
    model: string;
    dimensions?: number;
    apiKey?: string;
    constructor(config: { model?: string; openAIApiKey?: string; dimensions?: number }) {
      this.model = config.model ?? "";
      this.dimensions = config.dimensions;
      this.apiKey = config.openAIApiKey;
    }
    async embedQuery(_text: string): Promise<number[]> {
      return Array(this.dimensions || 1536).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(this.dimensions || 1536).fill(0.1));
    }
  },
}));

const { OpenAIEmbeddingProvider } = await import("../../openai-provider.js");

const ENV_KEYS = ["EMBEDDING_MODEL", "EMBEDDING_DIMENSIONS", "API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("OpenAIEmbeddingProvider (EMBD-02)", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("Test 1: providerName is 'openai'", () => {
    const provider = new OpenAIEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  it("Test 2: dimensions reflects constructor options", () => {
    const provider = new OpenAIEmbeddingProvider({ model: "text-embedding-3-small", dimensions: 1536 });
    expect(provider.dimensions).toBe(1536);
  });

  it("Test 3: constructor with no options reads EMBEDDING_MODEL/EMBEDDING_DIMENSIONS env with defaults", () => {
    const provider = new OpenAIEmbeddingProvider();
    expect(provider.dimensions).toBe(1536);

    process.env.EMBEDDING_DIMENSIONS = "256";
    const provider2 = new OpenAIEmbeddingProvider();
    expect(provider2.dimensions).toBe(256);
  });

  it("Test 4: embed(texts) resolves to number[][] sized to dimensions", async () => {
    const provider = new OpenAIEmbeddingProvider({ dimensions: 8 });
    const result = await provider.embed(["a", "b"]);
    expect(result).toHaveLength(2);
    for (const vec of result) {
      expect(vec).toHaveLength(8);
    }
  });

  it("Test 5: embedQuery(text) resolves to number[] sized to dimensions", async () => {
    const provider = new OpenAIEmbeddingProvider({ dimensions: 8 });
    const result = await provider.embedQuery("x");
    expect(result).toHaveLength(8);
  });

  it("Test 10: apiKey never surfaces in errors/logs (source-level discipline)", () => {
    // Constructing with an apiKey must not throw and must not include it anywhere retrievable
    const provider = new OpenAIEmbeddingProvider({ apiKey: "secret-key" });
    expect(JSON.stringify(provider)).not.toContain("secret-key");
  });
});
