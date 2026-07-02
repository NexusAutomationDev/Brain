import type { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ConfigurationError } from "@brain-pkg/shared";
import type { IEmbeddingProvider } from "./provider.interface.js";

/**
 * D-03/D-18: Gemini embedding provider.
 * Model default is "gemini-embedding-001" — NOT "text-embedding-004" (deprecated by
 * Google 2026-01-14, already returning "model not found" errors). D-18: default output
 * is 3072 dimensions; the installed @langchain/google-genai wrapper exposes NO parameter
 * to reduce this (Pitfall 4 — confirmed against installed 2.1.31 and latest 2.2.0 .d.ts).
 * EMBEDDING_DIMENSIONS must equal 3072 for Gemini-configured Brains unless a future
 * phase bypasses this LangChain wrapper for the raw @google/genai SDK.
 */
export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly providerName = "gemini";
  readonly dimensions: number;
  private embedder: GoogleGenerativeAIEmbeddings | null = null;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(options?: { model?: string; dimensions?: number; apiKey?: string }) {
    this.model = options?.model ?? process.env.EMBEDDING_MODEL ?? "gemini-embedding-001";
    this.dimensions = options?.dimensions ?? parseInt(process.env.EMBEDDING_DIMENSIONS ?? "3072", 10);
    // IN-03 (28-REVIEW)/D-18: gemini-embedding-001 always outputs 3072 dimensions — the
    // installed @langchain/google-genai wrapper exposes no parameter to reduce this.
    // Fail fast here instead of letting a misconfigured EMBEDDING_DIMENSIONS surface as
    // a cryptic Postgres "expected N dimensions, got 3072" error on the first embed call.
    if (this.dimensions !== 3072) {
      throw new ConfigurationError(
        `EMBEDDING_DIMENSIONS=${this.dimensions} is incompatible with Gemini — gemini-embedding-001 always outputs 3072 dimensions. Set EMBEDDING_DIMENSIONS=3072 or switch EMBEDDING_PROVIDER.`,
        { configuredDimensions: this.dimensions, requiredDimensions: 3072 }
      );
    }
    // T-2-03: apiKey read but never logged/thrown
    this.apiKey = options?.apiKey ?? process.env.API_KEY;
  }

  private async getEmbedder(): Promise<GoogleGenerativeAIEmbeddings> {
    if (!this.embedder) {
      const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
      this.embedder = new GoogleGenerativeAIEmbeddings({ model: this.model, apiKey: this.apiKey });
    }
    return this.embedder;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embedder = await this.getEmbedder();
    // Pitfall 3: embedDocuments() silently returns [] per-batch on partial failure —
    // this class does not swallow that; callers (ingest.ts, re-embed tool) must check
    // for empty-array entries before persisting (documented in those plans).
    return embedder.embedDocuments(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const embedder = await this.getEmbedder();
    return embedder.embedQuery(text);
  }
}
