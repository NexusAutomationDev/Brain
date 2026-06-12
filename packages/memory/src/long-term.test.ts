import { describe, it } from "bun:test";

describe("LongTermMemory (MEM-02)", () => {
  it.todo("readProfile(userId, key) returns stored value from memories table");
  it.todo("writeProfile(userId, key, value) upserts row in memories table");
  it.todo("readProfile returns null when key does not exist");
});
