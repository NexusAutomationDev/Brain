import type { OpenAIEmbeddings } from "@langchain/openai";
import type { IEmbeddingProvider } from "./provider.interface.js";

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly providerName = "openai";
  readonly dimensions: number;
  private embedder: OpenAIEmbeddings | null = null;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(options?: { model?: string; dimensions?: number; apiKey?: string }) {
    this.model = options?.model ?? process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    this.dimensions = options?.dimensions ?? parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536", 10);
    // T-2-03: apiKey read but never logged/thrown
    this.apiKey = options?.apiKey ?? process.env.API_KEY;
  }

  private async getEmbedder(): Promise<OpenAIEmbeddings> {
    if (!this.embedder) {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      this.embedder = new OpenAIEmbeddings({
        model: this.model,
        openAIApiKey: this.apiKey,
        dimensions: this.dimensions,
      });
    }
    return this.embedder;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embedder = await this.getEmbedder();
    return embedder.embedDocuments(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const embedder = await this.getEmbedder();
    return embedder.embedQuery(text);
  }
}
