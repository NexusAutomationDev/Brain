import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { StateGraph } from "@langchain/langgraph";
import { createCheckpointer } from "./checkpointer.js";
import { BrainStateAnnotation } from "./state.js";

// AI-01, MEM-01, SC-1: Integration tests against real brain_test database
// Requires: TEST_DATABASE_URL env var pointing to brain_test
// Setup: scripts/setup-test-db.sh must have been run
//
// KNOWN ISSUE (Gap 2): PostgresSaver.setup() hangs in bun test runner (Bun 1.3.2 + pg driver
// async hooks incompatibility). The test code is correct and works when invoked outside the
// bun test runner context.
//
// SC-1 manual verification (when TEST_DATABASE_URL is set):
//   TEST_DATABASE_URL=postgresql://user:pass@host/brain_test \
//     pnpm --filter @brain-pkg/ai run test:integration
//
// The test:integration script runs this file via `bun run` (not `bun test`), which completes
// PostgresSaver.setup() in ~8 seconds without hanging.

const TEST_URL = process.env.TEST_DATABASE_URL;

const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb("createCheckpointer + PostgresSaver (AI-01, MEM-01)", () => {
  let checkpointer: PostgresSaver;

  beforeAll(async () => {
    checkpointer = await createCheckpointer(TEST_URL!);
  }, 60000); // 60s timeout for PostgresSaver.setup() — pg driver is slow in bun test context

  afterAll(async () => {
    // Close the pg.Pool to avoid open handles in bun test
    await checkpointer.end?.();
  });

  it("createCheckpointer returns a PostgresSaver instance", () => {
    expect(checkpointer).toBeInstanceOf(PostgresSaver);
  });

  it("setup() creates checkpoint tables (no error on second call)", async () => {
    // setup() is idempotent — calling again should not throw
    await expect(checkpointer.setup()).resolves.toBeUndefined();
  });

  it("graph persists state across two separate invocations with same thread_id (SC-1)", async () => {
    const graph = new StateGraph(BrainStateAnnotation)
      .addNode("increment", (state) => ({ schema_version: state.schema_version + 1 }))
      .addEdge("__start__", "increment")
      .addEdge("increment", "__end__")
      .compile({ checkpointer });

    const threadId = `sc1-test-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    // Invocation 1: schema_version starts at 1, node increments to 2
    const result1 = await graph.invoke({ schema_version: 1 }, config);
    expect(result1.schema_version).toBe(2);

    // Invocation 2 (same thread_id — simulates container restart resuming persisted state)
    // PostgresSaver loads the checkpoint → schema_version is 2, node increments to 3
    const result2 = await graph.invoke({}, config);
    expect(result2.schema_version).toBe(3);
  });
});
