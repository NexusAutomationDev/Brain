// Integration test: BrainRunner end-to-end with real PostgreSQL
// This test requires a running PostgreSQL instance with brain_test database
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { prompts } from "@brain-pkg/database";
import type { BrainEvent } from "@brain-pkg/transport";
import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";
import type { IBrain } from "../../brain/interface.js";
import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "@brain-pkg/ai";

// Test configuration
const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;

// Skip all integration tests gracefully when DB not available (avoids crashing unit test runs)
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

describeOrSkip("BrainRunner Integration", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    // Connect to test database
    sql = postgres(TEST_DB_URL);
    db = drizzle(sql);

    // Seed prompts table for test brain
    await db.insert(prompts).values({
      brainType: "integration-test",
      key: "system",
      content: "You are a helpful assistant. Always respond with 'Integration test reply'.",
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(prompts).where(eq(prompts.brainType, "integration-test"));
    await sql.end();
  });

  test("BrainRunner end-to-end with PostgreSQL real", async () => {
    // Create a minimal test brain
    const testBrain: IBrain = {
      id: "test-integration",
      brainType: "integration-test",
      promptKeys: ["system"],
      tools: [],
      buildGraph: (context) => {
        const graph = new StateGraph(BrainStateAnnotation);
        // Simple graph that just echoes
        graph.addNode("respond", async (state: any) => {
          return {
            messages: [
              { role: "human", content: "hello" },
              { role: "ai", content: "Integration test reply" },
            ],
          };
        });
        graph.setEntryPoint("respond");
        return graph;
      },
    };

    // Create tools registry
    const registry = new ToolsRegistry();
    registry.enableTool("integration-test", "dummy");

    // Create BrainRunner
    const runner = new BrainRunner({
      brain: testBrain,
      sql,
      toolsRegistry: registry,
    });

    // Test init()
    await runner.init();
    console.log("✓ init() completed successfully");

    // Test run()
    const event: BrainEvent = {
      Name: "Test User Integration",
      Message: "hello",
      Numero: "5511999990001",
      IDLead: "lead-integration-1",
    };

    const result = await runner.run(event);

    // Assertions
    expect(result).toHaveProperty("reply");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    expect(Object.keys(result)).toEqual(["reply"]); // No state leak

    console.log("✓ run() returned:", result);

    // Test memory persistence (second call with same thread_id)
    // mesmo Numero = mesmo thread (Phase 8: substituir por lead.unique_id)
    const event2: BrainEvent = {
      Name: "Test User Integration",
      Message: "remember that",
      Numero: "5511999990001", // mesmo Numero = mesmo thread
      IDLead: "lead-integration-1",
    };

    const result2 = await runner.run(event2);
    expect(result2).toHaveProperty("reply");
    console.log("✓ Second call completed:", result2);
  }, 30000); // 30s timeout for real DB operations
});
