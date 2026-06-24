import type { Embeddings } from "@langchain/core/embeddings";

/**
 * D-17/D-14: Defaults de modelo de embedding por provider.
 * EMBEDDING_MODEL é opcional — resolvido automaticamente com base em LLM_PROVIDER.
 */
const DEFAULT_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  openrouter: "text-embedding-3-small",
  gemini: "text-embedding-004",
};

/**
 * D-14/D-17: Resolve o modelo de embedding pelo provider e env vars.
 * Exportado para testes de unidade da lógica de seleção de modelo.
 */
export function resolveEmbeddingModel(provider?: string): string {
  if (process.env.EMBEDDING_MODEL) return process.env.EMBEDDING_MODEL;
  const p = provider ?? process.env.LLM_PROVIDER ?? "openai";
  return DEFAULT_MODELS[p] ?? "text-embedding-3-small";
}

/**
 * D-06: Parse EMBEDDING_DIMENSIONS env var (sem hardcode).
 * Exportado para testes de unidade — garante que não há 1536 hardcoded.
 */
export function parseDimensions(): number | undefined {
  return process.env.EMBEDDING_DIMENSIONS
    ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;
}

/**
 * AI-04, D-14, D-17: Creates an Embeddings instance configured from env vars.
 *
 * Optional env vars:
 *   EMBEDDING_MODEL      — embedding model identifier (optional; defaults per provider below)
 *   EMBEDDING_DIMENSIONS — vector dimension (must match schema migration — irreversible)
 *   LLM_PROVIDER         — provider selection: "openai" | "openrouter" | "gemini" (default: "openai")
 *
 * D-14: When EMBEDDING_MODEL is absent, defaults are:
 *   openai/openrouter → text-embedding-3-small
 *   gemini            → text-embedding-004
 *
 * D-06: No hardcoded dimension default in this file.
 * The schema (Phase 1) already reads EMBEDDING_DIMENSIONS — both must stay in sync.
 *
 * Security (T-2-03): API_KEY is read but never logged or thrown.
 */
export async function createEmbeddings(): Promise<Embeddings> {
  // D-14: EMBEDDING_MODEL opcional — resolve default por provider se ausente
  const provider = process.env.LLM_PROVIDER || "openai";
  const model = resolveEmbeddingModel(provider);
  const dimensions = parseDimensions();
  // T-2-03: API_KEY never logged
  const apiKey = process.env.API_KEY;

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
