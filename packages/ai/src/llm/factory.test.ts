import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock all provider modules BEFORE any imports that use them
// (mock.module is hoisted in bun test)
mock.module("@langchain/openai", () => ({
  ChatOpenAI: class MockChatOpenAI {
    constructor(public config: Record<string, unknown>) {}
  },
}));

mock.module("@langchain/anthropic", () => ({
  ChatAnthropic: class MockChatAnthropic {
    constructor(public config: Record<string, unknown>) {}
  },
}));

mock.module("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: class MockChatGoogleGenerativeAI {
    constructor(public config: Record<string, unknown>) {}
  },
}));

// Import AFTER mocks are set up
const { createLLM } = await import("./factory.js");
const { ConfigurationError } = await import("@brain-pkg/shared");

describe("createLLM factory (AI-05)", () => {
  beforeEach(() => {
    // Reset env before each test
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.API_KEY;
  });

  it("throws ConfigurationError when LLM_PROVIDER is not set", async () => {
    await expect(createLLM()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("throws with message containing 'LLM_PROVIDER env var is required'", async () => {
    await expect(createLLM()).rejects.toThrow("LLM_PROVIDER env var is required");
  });

  it("throws ConfigurationError for unknown LLM_PROVIDER", async () => {
    process.env.LLM_PROVIDER = "unknown_provider";
    await expect(createLLM()).rejects.toThrow("Unknown LLM_PROVIDER");
  });

  it("returns BaseChatModel when LLM_PROVIDER=openai (mocked)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o";
    process.env.API_KEY = "test-key";
    const llm = await createLLM();
    expect(llm).toBeDefined();
    expect(llm.constructor.name).toBe("MockChatOpenAI");
  });

  it("returns BaseChatModel when LLM_PROVIDER=anthropic (mocked)", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_MODEL = "claude-sonnet-4-6";
    process.env.API_KEY = "test-key";
    const llm = await createLLM();
    expect(llm.constructor.name).toBe("MockChatAnthropic");
  });

  it("returns BaseChatModel when LLM_PROVIDER=gemini (mocked)", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_MODEL = "gemini-2.0-flash";
    process.env.API_KEY = "test-key";
    const llm = await createLLM();
    expect(llm.constructor.name).toBe("MockChatGoogleGenerativeAI");
  });

  it("returns ChatOpenAI when LLM_PROVIDER=openrouter (mocked)", async () => {
    process.env.LLM_PROVIDER = "openrouter";
    process.env.LLM_MODEL = "openai/gpt-4o";
    process.env.API_KEY = "test-key";
    const llm = await createLLM();
    expect(llm.constructor.name).toBe("MockChatOpenAI");
  });

  it("error message does not contain API_KEY value (T-2-03)", async () => {
    process.env.LLM_PROVIDER = "bad_provider";
    process.env.API_KEY = "secret-key-should-not-appear";
    try {
      await createLLM();
      expect(true).toBe(false); // should not reach here
    } catch (err: unknown) {
      const errorStr = String(err);
      expect(errorStr).not.toContain("secret-key-should-not-appear");
    }
  });
});
