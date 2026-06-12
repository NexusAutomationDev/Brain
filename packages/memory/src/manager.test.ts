import { describe, it } from "bun:test";

describe("MemoryManager (MEM-04, SC-2)", () => {
  it.todo("getContext() reads long-term profile, short-term checkpoint, and semantic results in one call");
  it.todo("saveContext() writes to all three layers without error");
  it.todo("three memory layers are exercised in a single test (SC-2)");
});
