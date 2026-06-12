import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { FakeEmbeddings } from "@langchain/core/utils/testing";
import { MemoryManager } from "./manager.js";
import { createCheckpointer } from "@brain-pkg/ai";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

// SC-2: MemoryManager reads long-term profile, short-term checkpoint,
// and semantic results in a single test
describeIfDb("MemoryManager (MEM-04, SC-2)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;
  let checkpointer: PostgresSaver;
  let manager: MemoryManager;
  const testUserId = `manager-test-${Date.now()}`;
  const testThreadId = `thread-${Date.now()}`;
  const fakeEmbeddings = new FakeEmbeddings();

  beforeAll(async () => {
    sql = postgres(TEST_URL!);
    db = drizzle(sql) as PostgresJsDatabase;
    checkpointer = await createCheckpointer(TEST_URL!);
    manager = new MemoryManager({ db, checkpointer });
  });

  afterAll(async () => {
    await (checkpointer as unknown as { end?: () => Promise<void> }).end?.();
    await sql.end();
  });

  it("getContext() returns MemoryContext with all 3 layers (SC-2)", async () => {
    // Setup: write a profile entry for long-term layer
    await manager.saveContext({
      userId: testUserId,
      profileKey: "preferences",
      profileValue: { language: "pt-BR" },
    });

    // Query with a fake vector for semantic layer
    const queryVector = await fakeEmbeddings.embedQuery("test query");

    // SC-2: Single call exercises all 3 layers
    const ctx = await manager.getContext(testThreadId, testUserId, queryVector, "preferences");

    expect(ctx).toHaveProperty("profile");
    expect(ctx).toHaveProperty("checkpoint");
    expect(ctx).toHaveProperty("similarEmbeddings");
    expect(ctx.profile).toEqual({ language: "pt-BR" }); // long-term layer
    expect(Array.isArray(ctx.similarEmbeddings)).toBe(true); // semantic layer
    // checkpoint is undefined for new thread (no prior graph invocations)
    expect(ctx.checkpoint).toBeUndefined(); // short-term layer
  });

  it("saveContext() writes to long-term and (optionally) semantic layers", async () => {
    const vector = await fakeEmbeddings.embedQuery("save context test");
    await manager.saveContext({
      userId: testUserId,
      profileKey: "test-key",
      profileValue: { saved: true },
      embedding: {
        userId: testUserId,
        sessionId: testThreadId,
        content: "save context test",
        embedding: vector,
      },
    });

    const ctx = await manager.getContext(testThreadId, testUserId, vector, "test-key");
    expect(ctx.profile).toEqual({ saved: true });
  });

  it("getContext() checkpoint is undefined for a thread with no prior invocations", async () => {
    const ctx = await manager.getContext(
      `new-thread-${Date.now()}`,
      testUserId,
      []
    );
    expect(ctx.checkpoint).toBeUndefined();
  });
});
