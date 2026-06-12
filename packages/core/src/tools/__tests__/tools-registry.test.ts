// SDK-03: ToolsRegistry — enable/disable tools per brainType
// Wave 0 stub: tests are todo until implementation exists in tools/registry.ts

import { describe, test } from "bun:test";

describe("ToolsRegistry", () => {
  test.todo("getTools() returns only tools enabled for a brainType");
  test.todo("getTools() returns empty array when brainType has no enabled tools");
  test.todo("getTools() throws ConfigurationError when brainType is not registered");
  test.todo("enableTool() adds a tool to the allowed set for a brainType");
  test.todo("disableTool() removes a tool from the allowed set for a brainType");
});
