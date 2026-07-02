import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";

// Mock the underlying LangChain SDKs (not the sibling provider modules) — mock.module
// patches the global module registry by resolved path, so mocking "../../openai-provider.js"
// or "../../gemini-provider.js" directly would leak into openai-provider.test.ts /
// gemini-provider.test.ts when the full suite runs in one process. Mocking the LangChain
// packages instead is safe because those are also mocked (identically) in the provider
// test files, so there is no behavior mismatch.
mock.module("@langchain/openai", () => ({
  OpenAIEmbeddings: class MockOpenAIEmbeddings {
    async embedQuery(_text: string): Promise<number[]> {
      return Array(1536).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(1536).fill(0.1));
    }
  },
}));

mock.module("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: class MockGoogleGenerativeAIEmbeddings {
    async embedQuery(_text: string): Promise<number[]> {
      return Array(3072).fill(0.1);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array(3072).fill(0.1));
    }
  },
}));

const { createEmbeddingProvider, resolveEmbeddingProviderName } = await import("../../factory.js");

// D-13 gap fix (32-06, follow-on from 32-VERIFICATION.md Gap 1): EMBEDDING_DIMENSIONS is
// reset/restored alongside EMBEDDING_PROVIDER/LLM_PROVIDER because this repo's gitignored,
// local-only .env.test sets EMBEDDING_DIMENSIONS=128 (auto-loaded by `bun test`), which trips
// GeminiEmbeddingProvider's fail-fast "!== 3072" ConfigurationError guard in Test 1 and Test 3
// (both resolve to the gemini provider). Without this reset, those two tests fail in ANY
// environment where the ambient EMBEDDING_DIMENSIONS differs from 3072 — the exact class of
// cross-environment drift bug documented for brain-runner.test.ts.
const ENV_KEYS = ["EMBEDDING_PROVIDER", "LLM_PROVIDER", "EMBEDDING_DIMENSIONS"] as const;
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
