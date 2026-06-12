import { CallbackHandler } from "@langfuse/langchain";

/**
 * OBS-03: Tracing context passed to Langfuse for trace annotation.
 */
export interface TracingContext {
  sessionId?: string;
  userId?: string;
  brainId?: string;
}

/**
 * OBS-03, D-01, D-02: Conditionally create Langfuse tracing callbacks.
 *
 * Returns a [CallbackHandler] when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
 * are both set in the environment. Returns [] when either is absent.
 *
 * This allows Brain agents to pass the result directly to LangGraph graph.invoke():
 *   await graph.invoke(input, { configurable: { thread_id }, callbacks })
 *
 * D-02: Silent no-op when keys are absent — no startup failure, no error thrown.
 *
 * Security (T-2-03): LANGFUSE_SECRET_KEY is read from env but NEVER logged,
 * never included in error messages, and never returned in any response.
 *
 * Usage in integration tests (RESEARCH.md Pitfall 4):
 *   const [handler] = createTracingCallbacks({ sessionId });
 *   await graph.invoke(input, { callbacks: [handler] });
 *   await handler.flushAsync(); // flush before test exits
 *
 * @param context - Optional metadata to annotate traces (sessionId, userId, brainId)
 * @returns Array of callbacks to pass to graph.invoke() — empty when keys absent
 */
export function createTracingCallbacks(context?: TracingContext): CallbackHandler[] {
  // D-02: Silent fallback when env vars absent — no startup failure
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return [];
  }

  return [
    new CallbackHandler({
      sessionId: context?.sessionId,
      userId: context?.userId,
      tags: context?.brainId ? [`brain:${context.brainId}`] : undefined,
    }),
  ];
}
