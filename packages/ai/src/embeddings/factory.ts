import type { Embeddings } from "@langchain/core/embeddings";
import { ConfigurationError } from "@brain-pkg/shared";

/**
 * AI-04, D-06: Creates an Embeddings instance configured from env vars.
 *
 * Required env vars:
 *   EMBEDDING_MODEL      — embedding model identifier (e.g., text-embedding-3-small)
 *   EMBEDDING_DIMENSIONS — vector dimension (must match schema migration — irreversible)
 *
 * D-06: No hardcoded model name or dimension default in this file.
 * The schema (Phase 1) already reads EMBEDDING_DIMENSIONS — both must stay in sync.
 *
 * Security (T-2-03): API_KEY is read but never logged or thrown.
 */
export async function createEmbeddings(): Promise<Embeddings> {
  const model = process.env.EMBEDDING_MODEL;
  const dimensions = process.env.EMBEDDING_DIMENSIONS
    ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;
  // T-2-03: API_KEY never logged
  const apiKey = process.env.API_KEY;

  if (!model) {
    throw new ConfigurationError("EMBEDDING_MODEL env var is required", { model: "missing" });
  }

  // Detect provider from LLM_PROVIDER env or fall back to openai
  // OpenAI embeddings: "text-embedding-*" prefix
  // Google embeddings: "models/embedding-*" or "embedding-001" prefix
  const provider = process.env.LLM_PROVIDER || "openai";

  switch (provider) {
    case "gemini": {
      const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
      return new GoogleGenerativeAIEmbeddings({ model, apiKey });
    }
    default: {
      // openai and openrouter both use OpenAI embeddings API
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      return new OpenAIEmbeddings({ model, openAIApiKey: apiKey, dimensions });
    }
  }
}
