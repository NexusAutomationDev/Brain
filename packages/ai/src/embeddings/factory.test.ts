import { describe, it } from "bun:test";

describe("createEmbeddings factory (AI-04)", () => {
  it.todo("throws ConfigurationError when EMBEDDING_MODEL is not set");
  it.todo("returns Embeddings instance configured from EMBEDDING_MODEL env var");
  it.todo("uses EMBEDDING_DIMENSIONS env var without hardcoding 1536");
});
