// SDK-04: loadPrompts — load prompts from prompts table by brainType + keys
import { describe, test, expect, mock } from "bun:test";

// Mock the @brain-pkg/database module before importing loadPrompts
// to avoid real DB connection in unit tests
const mockSelect = mock(() => ({
  from: mock(() => ({
    where: mock(async () => []),
  })),
}));

const mockDrizzle = mock(() => ({
  select: mockSelect,
}));

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mockDrizzle,
}));

mock.module("@brain-pkg/database", () => ({
  prompts: { brainType: "brain_type", key: "key", content: "content" },
  eq: mock((...args: unknown[]) => args),
  and: mock((...args: unknown[]) => args),
  inArray: mock((...args: unknown[]) => args),
}));

import { loadPrompts } from "../loader.js";

describe("loadPrompts", () => {
  test("returns Record<string, string> mapping key to content for given brainType", async () => {
    const mockRows = [
      { key: "system", content: "You are a helpful assistant" },
      { key: "greeting", content: "Hello! How can I help?" },
    ];
    mockSelect.mockImplementation(() => ({
      from: mock(() => ({
        where: mock(async () => mockRows),
      })),
    }));

    const result = await loadPrompts({} as never, "echo", ["system", "greeting"]);
    expect(result).toEqual({
      system: "You are a helpful assistant",
      greeting: "Hello! How can I help?",
    });
  });

  test("returns only the keys requested (ignores other keys for same brainType)", async () => {
    // DB returns only what was filtered — test that we don't accidentally return extras
    const mockRows = [{ key: "system", content: "System prompt" }];
    mockSelect.mockImplementation(() => ({
      from: mock(() => ({
        where: mock(async () => mockRows),
      })),
    }));

    const result = await loadPrompts({} as never, "echo", ["system"]);
    expect(Object.keys(result)).toEqual(["system"]);
    expect(result.system).toBe("System prompt");
  });

  test("returns empty object when no matching rows found", async () => {
    mockSelect.mockImplementation(() => ({
      from: mock(() => ({
        where: mock(async () => []),
      })),
    }));

    const result = await loadPrompts({} as never, "echo", ["missing-key"]);
    expect(result).toEqual({});
  });
});
