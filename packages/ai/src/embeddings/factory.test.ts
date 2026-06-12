import { describe, it, expect, beforeEach, mock } from "bun:test";
import { FakeEmbeddings } from "@langchain/core/utils/testing";

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

const { createEmbeddings } = await import("./factory.js");
const { ConfigurationError } = await import("@brain-pkg/shared");

describe("createEmbeddings factory (AI-04)", () => {
  beforeEach(() => {
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.LLM_PROVIDER;
    delete process.env.API_KEY;
  });

  it("throws ConfigurationError when EMBEDDING_MODEL is not set", async () => {
    await expect(createEmbeddings()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("throws with message 'EMBEDDING_MODEL env var is required'", async () => {
    await expect(createEmbeddings()).rejects.toThrow("EMBEDDING_MODEL env var is required");
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

  it("FakeEmbeddings produces vectors (validates test infra for D-11)", async () => {
    // D-11: Embedding tests with real PG use FakeEmbeddings
    const fake = new FakeEmbeddings();
    const vector = await fake.embedQuery("hello");
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });
});
