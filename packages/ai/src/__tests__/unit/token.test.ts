import { describe, it, expect } from "bun:test";
import { extractTokenUsage } from "../../utils/token.js";
import type { AIMessage } from "@langchain/core/messages";

describe("extractTokenUsage (TOK-01, TOK-02)", () => {
  it("TOK-01: extractTokenUsage is exported from utils/token", () => {
    expect(typeof extractTokenUsage).toBe("function");
  });

  it("TOK-02a: returns zeros when usage_metadata is undefined (D-05)", () => {
    // AIMessage without usage_metadata — mock the shape
    const msg = { usage_metadata: undefined } as unknown as AIMessage;
    const result = extractTokenUsage(msg);
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it("TOK-02b: converts snake_case to camelCase (D-04)", () => {
    const msg = {
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    } as unknown as AIMessage;
    const result = extractTokenUsage(msg);
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("TOK-02c: returns zeros when usage_metadata is null (D-05)", () => {
    const msg = { usage_metadata: null } as unknown as AIMessage;
    const result = extractTokenUsage(msg);
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it("TOK-02d: sums correctly with non-zero values", () => {
    const msg = {
      usage_metadata: { input_tokens: 512, output_tokens: 128, total_tokens: 640 },
    } as unknown as AIMessage;
    const result = extractTokenUsage(msg);
    expect(result.inputTokens).toBe(512);
    expect(result.outputTokens).toBe(128);
    expect(result.totalTokens).toBe(640);
  });
});
