import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ConfigurationError } from "@brain-pkg/shared";

/**
 * Options for LLM configuration.
 * All required config (provider, model, API key) comes from env vars — not these options.
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * AI-05, D-06, D-07: Creates an LLM instance configured from env vars.
 *
 * Required env vars:
 *   LLM_PROVIDER — one of: openai | anthropic | gemini | openrouter
 *   LLM_MODEL    — model name (e.g., gpt-4o, claude-sonnet-4-6, gemini-2.0-flash)
 *   API_KEY      — provider API key (NEVER logged — T-2-03)
 *
 * D-07: Throws ConfigurationError if LLM_PROVIDER is not set.
 * D-08: Supports openai, anthropic, gemini, openrouter.
 * Security (T-2-03): API_KEY is read but NEVER included in error messages, logs, or context.
 */
export async function createLLM(options: LLMOptions = {}): Promise<BaseChatModel> {
  const provider = process.env.LLM_PROVIDER;
  const model = process.env.LLM_MODEL;
  // T-2-03: API_KEY is read from env, never logged or thrown
  const apiKey = process.env.API_KEY;

  if (!provider) {
    throw new ConfigurationError("LLM_PROVIDER env var is required", { provider: "missing" });
  }

  // model and apiKey may be undefined — each LLM constructor handles its own validation
  // Cast to string to satisfy TypeScript; missing values will surface as runtime errors
  // from the provider SDK (never logging apiKey — T-2-03)
  const modelStr = model as string;
  const apiKeyStr = apiKey as string;

  switch (provider) {
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model: modelStr, apiKey: apiKeyStr, ...options });
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model: modelStr, apiKey: apiKeyStr, ...options });
    }
    case "gemini": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return new ChatGoogleGenerativeAI({ model: modelStr, apiKey: apiKeyStr, ...options });
    }
    case "openrouter": {
      const { ChatOpenAI } = await import("@langchain/openai");
      // D-08: OpenRouter is OpenAI-compatible with a custom baseURL
      return new ChatOpenAI({
        model: modelStr,
        apiKey: apiKeyStr,
        configuration: { baseURL: "https://openrouter.ai/api/v1" },
        ...options,
      });
    }
    default:
      // T-2-03: Do NOT include apiKey in error context
      throw new ConfigurationError(`Unknown LLM_PROVIDER: ${provider}`, { provider });
  }
}
