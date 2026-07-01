import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";

mock.module("../../openai-provider.js", () => ({
  OpenAIEmbeddingProvider: class MockOpenAIEmbeddingProvider {
    providerName = "openai";
    dimensions = 1536;
  },
}));

mock.module("../../gemini-provider.js", () => ({
  GeminiEmbeddingProvider: class MockGeminiEmbeddingProvider {
    providerName = "gemini";
    dimensions = 3072;
  },
}));

const { createEmbeddingProvider, resolveEmbeddingProviderName } = await import("../../factory.js");

const ENV_KEYS = ["EMBEDDING_PROVIDER", "LLM_PROVIDER"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

describe("createEmbeddingProvider factory (EMBD-04)", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("Test 1: EMBEDDING_PROVIDER=gemini resolves to gemini provider", async () => {
    process.env.EMBEDDING_PROVIDER = "gemini";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("gemini");
  });

  it("Test 2: EMBEDDING_PROVIDER=openai resolves to openai provider", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  it("Test 3: EMBEDDING_PROVIDER absent, LLM_PROVIDER=gemini falls back to gemini (D-12)", async () => {
    process.env.LLM_PROVIDER = "gemini";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("gemini");
  });

  it("Test 4: EMBEDDING_PROVIDER absent, LLM_PROVIDER=anthropic falls back to openai (D-12)", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  it("Test 5: EMBEDDING_PROVIDER absent, LLM_PROVIDER absent defaults to openai", async () => {
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  it("Test 6: EMBEDDING_PROVIDER=openrouter resolves to openai provider (OpenAI-compatible)", async () => {
    process.env.EMBEDDING_PROVIDER = "openrouter";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  it("Test 7: EMBEDDING_PROVIDER=unknown-provider rejects with ConfigurationError, no apiKey in context", async () => {
    process.env.EMBEDDING_PROVIDER = "unknown-provider";
    await expect(createEmbeddingProvider()).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringContaining("Unknown EMBEDDING_PROVIDER: unknown-provider"),
    });

    try {
      await createEmbeddingProvider();
      throw new Error("should have rejected");
    } catch (err) {
      const context = (err as { context?: Record<string, unknown> }).context;
      expect(context).toBeDefined();
      expect(context).not.toHaveProperty("apiKey");
    }
  });

  it("Test 8 (D-13): explicit EMBEDDING_PROVIDER=openai stays openai even if LLM_PROVIDER changes to anthropic", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.LLM_PROVIDER = "anthropic";
    const provider = await createEmbeddingProvider();
    expect(provider.providerName).toBe("openai");
  });

  describe("resolveEmbeddingProviderName", () => {
    it("returns explicit EMBEDDING_PROVIDER when set", () => {
      process.env.EMBEDDING_PROVIDER = "gemini";
      expect(resolveEmbeddingProviderName()).toBe("gemini");
    });

    it("returns LLM_PROVIDER when capable and EMBEDDING_PROVIDER absent", () => {
      process.env.LLM_PROVIDER = "openrouter";
      expect(resolveEmbeddingProviderName()).toBe("openrouter");
    });

    it("returns openai default when neither is set", () => {
      expect(resolveEmbeddingProviderName()).toBe("openai");
    });
  });
});
