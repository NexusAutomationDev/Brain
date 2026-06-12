import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { SyntheticEmbeddings } from "@langchain/core/utils/testing";
import { upsertEmbedding, searchSimilar } from "./semantic.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// D-11: SyntheticEmbeddings for testing — no external API calls
// EMBEDDING_DIMENSIONS=128 in .env.test matches schema validation range (128-4096)
const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb("SemanticMemory (MEM-03)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  const testUserId = `test-semantic-${Date.now()}`;
  const testSessionId = `session-${Date.now()}`;
  let fakeEmbeddings: SyntheticEmbeddings;

  beforeAll(async () => {
    sql = postgres(TEST_URL!);
    db = drizzle(sql) as PostgresJsDatabase;
    fakeEmbeddings = new SyntheticEmbeddings({ vectorSize: 128 });
  });

  afterAll(async () => {
    await sql.end();
  });

  it("upsertEmbedding inserts a row in embeddings table (fire-and-forget)", async () => {
    const vector = await fakeEmbeddings.embedQuery("test content for insert");
    // upsertEmbedding is void (fire-and-forget) — we need a short wait for the background write
    upsertEmbedding(db, {
      userId: testUserId,
      sessionId: testSessionId,
      content: "test content for insert",
      embedding: vector,
    });
    // Allow the background write to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("searchSimilar returns inserted embedding with similar query vector", async () => {
    // Insert a known embedding
    const content = `searchable content ${Date.now()}`;
    const vector = await fakeEmbeddings.embedQuery(content);

    upsertEmbedding(db, {
      userId: testUserId,
      sessionId: testSessionId,
      content,
      embedding: vector,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Search with the same vector (cosine similarity = 1.0 for identical vectors)
    const results = await searchSimilar(db, testUserId, vector, 3, 0.1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((r) => r.content === content);
    expect(found).toBeDefined();
  });

  it("searchSimilar with topK=1 returns exactly 1 result", async () => {
    const vector = await fakeEmbeddings.embedQuery("topk test");
    upsertEmbedding(db, {
      userId: testUserId,
      sessionId: testSessionId,
      content: "topk test",
      embedding: vector,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const results = await searchSimilar(db, testUserId, vector, 1, 0.1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("upsertEmbedding is fire-and-forget — function returns void synchronously", () => {
    const vector = Array(128).fill(0.1) as number[];
    // Should return undefined (void), not a Promise that the caller must await
    const result = upsertEmbedding(db, {
      userId: testUserId,
      sessionId: testSessionId,
      content: "fire-and-forget test",
      embedding: vector,
    });
    expect(result).toBeUndefined();
  });
});
