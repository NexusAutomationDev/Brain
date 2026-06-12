import { describe, it } from "bun:test";

describe("DedupCache (TRANS-03)", () => {
  it.todo("claim(requestId) returns true on first call");
  it.todo("claim(requestId) returns false on duplicate within TTL");
  it.todo("duplicate X-Request-Id on POST /api/v1/webhook returns 409 (SC-3)");
  it.todo("expired entry after TTL is evicted and claim returns true again");
});
