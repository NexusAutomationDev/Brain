import { describe, it } from "bun:test";

describe("createCheckpointer + PostgresSaver (AI-01, MEM-01)", () => {
  it.todo("createCheckpointer(TEST_DATABASE_URL) returns PostgresSaver");
  it.todo("setup() creates checkpoint tables without error");
  it.todo("graph persists state across two separate invocations with same thread_id (SC-1)");
  it.todo("MemorySaver is NOT used in createCheckpointer implementation");
});
