import { ConfigurationError } from "@brain-pkg/shared";
import type { IEmbeddingProvider } from "./provider.interface.js";

/**
 * D-12: Providers capable of generating embeddings — used for LLM_PROVIDER fallback mapping.
 * "anthropic" is deliberately excluded — it has no embedding API.
 */
const CAPABLE_PROVIDERS = new Set(["openai", "openrouter", "gemini"]);

/**
 * D-11/D-12/D-13: Resolves the embedding provider name.
 * EMBEDDING_PROVIDER is independent from LLM_PROVIDER (D-11, D-13).
 * When EMBEDDING_PROVIDER is absent, falls back to LLM_PROVIDER only if it is capable
 * of generating embeddings (D-12) — otherwise defaults to "openai".
 * Exported for unit testing of the resolution logic in isolation.
 */
export function resolveEmbeddingProviderName(): string {
  const explicit = process.env.EMBEDDING_PROVIDER?.trim();
  if (explicit) return explicit;
  const llmProvider = process.env.LLM_PROVIDER?.trim();
  if (llmProvider && CAPABLE_PROVIDERS.has(llmProvider)) return llmProvider;
  return "openai";
}

/**
 * EMBD-04: Creates an IEmbeddingProvider instance configured entirely from env vars —
 * no TypeScript change needed to switch provider/model/dimensions.
 */
export async function createEmbeddingProvider(): Promise<IEmbeddingProvider> {
  const provider = resolveEmbeddingProviderName();
  switch (provider) {
    case "gemini": {
      const { GeminiEmbeddingProvider } = await import("./gemini-provider.js");
      return new GeminiEmbeddingProvider();
    }
    case "openai":
    case "openrouter": {
      const { OpenAIEmbeddingProvider } = await import("./openai-provider.js");
      return new OpenAIEmbeddingProvider();
    }
    default:
      // T-2-03: do NOT include apiKey in error context — only the invalid provider name
      throw new ConfigurationError(`Unknown EMBEDDING_PROVIDER: ${provider}`, { provider });
  }
}
