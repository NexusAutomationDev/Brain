import { describe, it } from "bun:test";

describe("SemanticMemory (MEM-03)", () => {
  it.todo("upsertEmbedding inserts a row into embeddings table");
  it.todo("searchSimilar returns top-3 nearest embeddings by cosine similarity");
  it.todo("upsertEmbedding is fire-and-forget (does not block caller)");
});
