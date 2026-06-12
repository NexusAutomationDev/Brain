import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock @langfuse/langchain before importing the module under test
mock.module("@langfuse/langchain", () => ({
  CallbackHandler: class MockCallbackHandler {
    sessionId?: string;
    userId?: string;
    tags?: string[];

    constructor(config?: { sessionId?: string; userId?: string; tags?: string[] }) {
      this.sessionId = config?.sessionId;
      this.userId = config?.userId;
      this.tags = config?.tags;
    }

    async flushAsync() {
      // No-op in tests
    }
  },
}));

const { createTracingCallbacks } = await import("./tracing.js");

describe("createTracingCallbacks (OBS-03)", () => {
  const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  afterEach(() => {
    // Restore original env state
    if (originalPublicKey) process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    else delete process.env.LANGFUSE_PUBLIC_KEY;
    if (originalSecretKey) process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
    else delete process.env.LANGFUSE_SECRET_KEY;
  });

  it("returns empty array when LANGFUSE_PUBLIC_KEY is absent (D-02)", () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    process.env.LANGFUSE_SECRET_KEY = "secret";
    const callbacks = createTracingCallbacks();
    expect(callbacks).toEqual([]);
  });

  it("returns empty array when LANGFUSE_SECRET_KEY is absent (D-02)", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "public";
    delete process.env.LANGFUSE_SECRET_KEY;
    const callbacks = createTracingCallbacks();
    expect(callbacks).toEqual([]);
  });

  it("returns empty array when both keys are absent (D-02)", () => {
    const callbacks = createTracingCallbacks();
    expect(callbacks).toEqual([]);
  });

  it("returns [CallbackHandler] when both keys are set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const callbacks = createTracingCallbacks({ sessionId: "s1", userId: "u1" });
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toBeDefined();
  });

  it("returned CallbackHandler has flushAsync method (Pitfall 4 compliance)", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const [handler] = createTracingCallbacks();
    expect(typeof (handler as { flushAsync?: () => Promise<void> }).flushAsync).toBe("function");
  });

  it("LANGFUSE_SECRET_KEY value never appears in response (T-2-03)", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-safe";
    process.env.LANGFUSE_SECRET_KEY = "sk-super-secret-value";
    const callbacks = createTracingCallbacks({ sessionId: "s1" });
    // Stringify the returned object and verify secret is not leaked
    const serialized = JSON.stringify(callbacks);
    expect(serialized).not.toContain("sk-super-secret-value");
  });
});
