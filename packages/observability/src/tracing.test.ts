import { describe, it } from "bun:test";

describe("createTracingCallbacks (OBS-03)", () => {
  it.todo("returns empty array when LANGFUSE_PUBLIC_KEY is absent");
  it.todo("returns empty array when LANGFUSE_SECRET_KEY is absent");
  it.todo("returns [CallbackHandler] when both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set");
  it.todo("never logs API_KEY or LANGFUSE_SECRET_KEY values (T-2-03)");
});
