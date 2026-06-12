// SDK-02: BrainRunner — lifecycle init() + run() returning { reply: string }
// Wave 0 stub: tests are todo until implementation exists in runner/runner.ts

import { describe, test } from "bun:test";

describe("BrainRunner", () => {
  test.todo("init() loads prompts from DB and compiles the graph");
  test.todo("init() calls process.exit(1) when a promptKey is missing from DB");
  test.todo("run(event) returns { reply: string } with the last AIMessage content");
  test.todo("run(event) does NOT expose LangGraph internal state in the return value");
  test.todo("refreshPrompts() reloads prompts from DB and recompiles the graph");
});
