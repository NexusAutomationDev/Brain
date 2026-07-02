// D-08/IN-03 (29-REVIEW): Shared AI-message type-guard — extracted from the duplicated
// inline `tool_calls` checks in apps/brain-sdr and apps/brain-support's routeAfterLlm /
// respond-detection logic. Lives in packages/core (runtime helper, not a pure type) per
// CONTEXT.md — packages/shared holds pure types/duck-typed interfaces only.
//
// Structurally typed (duck typing) against LangChain's AIMessage shape to avoid a hard
// dependency on @langchain/core/messages here — callers pass their own message objects
// (real AIMessage instances or the test-mocked equivalents already used in brain.test.ts).
interface ToolCallLike {
  name: string;
}

interface MessageWithToolCalls {
  tool_calls?: ToolCallLike[];
}

/**
 * Returns true if `message` has at least one tool call named `toolName`.
 * Safe against undefined messages and messages with no `tool_calls` property.
 */
export function hasToolCall(message: unknown, toolName: string): boolean {
  if (!message || typeof message !== "object" || !("tool_calls" in message)) return false;
  const toolCalls = (message as MessageWithToolCalls).tool_calls ?? [];
  return toolCalls.some((tc) => tc.name === toolName);
}

/**
 * Returns the name of the first tool call on `message`, or undefined if there are
 * none / the message has no tool_calls property. Used by routeAfterLlm-style routers
 * that only need to inspect the first tool call's name.
 */
export function getFirstToolCallName(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || !("tool_calls" in message)) return undefined;
  const toolCalls = (message as MessageWithToolCalls).tool_calls ?? [];
  return toolCalls[0]?.name;
}
