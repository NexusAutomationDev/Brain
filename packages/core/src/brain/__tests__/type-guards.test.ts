// D-08/IN-03 (29-REVIEW): tests for the shared hasToolCall/getFirstToolCallName type-guards
import { describe, test, expect } from "bun:test";
import { hasToolCall, getFirstToolCallName } from "../type-guards.js";

describe("hasToolCall", () => {
  test("retorna true quando tool_calls[0].name === toolName", () => {
    const aiMessageWithToolCalls = {
      tool_calls: [{ name: "respond" }],
    };
    expect(hasToolCall(aiMessageWithToolCalls, "respond")).toBe(true);
  });

  test("retorna false quando tool_calls existe mas nenhuma entrada tem name === toolName", () => {
    const aiMessageWithToolCalls = {
      tool_calls: [{ name: "qualify_lead" }, { name: "search_knowledge" }],
    };
    expect(hasToolCall(aiMessageWithToolCalls, "respond")).toBe(false);
  });

  test("retorna false quando a mensagem não tem a propriedade tool_calls (sem throw)", () => {
    const messageWithNoToolCallsProperty = { content: "olá" };
    expect(hasToolCall(messageWithNoToolCallsProperty, "respond")).toBe(false);
  });

  test("retorna false quando message é undefined (sem throw)", () => {
    expect(hasToolCall(undefined, "respond")).toBe(false);
  });
});

describe("getFirstToolCallName", () => {
  test("retorna o nome da primeira tool call", () => {
    const aiMessageWithToolCalls = {
      tool_calls: [{ name: "respond" }, { name: "qualify_lead" }],
    };
    expect(getFirstToolCallName(aiMessageWithToolCalls)).toBe("respond");
  });

  test("retorna undefined quando não há tool calls", () => {
    const aiMessageWithToolCalls = { tool_calls: [] };
    expect(getFirstToolCallName(aiMessageWithToolCalls)).toBeUndefined();
  });

  test("retorna undefined quando message é undefined", () => {
    expect(getFirstToolCallName(undefined)).toBeUndefined();
  });

  test("retorna undefined quando a mensagem não tem a propriedade tool_calls", () => {
    const messageWithNoToolCallsProperty = { content: "olá" };
    expect(getFirstToolCallName(messageWithNoToolCallsProperty)).toBeUndefined();
  });
});
