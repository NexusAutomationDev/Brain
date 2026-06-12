import { describe, it } from "bun:test";

describe("createLLM factory (AI-05)", () => {
  it.todo("throws ConfigurationError when LLM_PROVIDER is not set");
  it.todo("throws ConfigurationError with 'Unknown LLM_PROVIDER' for unknown provider");
  it.todo("returns BaseChatModel when LLM_PROVIDER=openai and API_KEY set (mocked)");
  it.todo("returns BaseChatModel when LLM_PROVIDER=anthropic (mocked)");
  it.todo("returns BaseChatModel when LLM_PROVIDER=gemini (mocked)");
  it.todo("returns BaseChatModel when LLM_PROVIDER=openrouter with custom baseURL (mocked)");
});
