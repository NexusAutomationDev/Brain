// SDK-04: loadPrompts — load prompts from prompts table by brainType + keys
// Wave 0 stub: tests are todo until implementation exists in prompts/loader.ts

import { describe, test } from "bun:test";

describe("loadPrompts", () => {
  test.todo("returns Record<string, string> mapping key to content for given brainType");
  test.todo("returns only the keys requested (ignores other keys for same brainType)");
  test.todo("returns empty object when no matching rows found");
});
