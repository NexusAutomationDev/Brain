import { describe, it, expect, beforeEach } from "bun:test";
import { DedupCache } from "./dedup.js";

describe("DedupCache (TRANS-03)", () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache();
  });

  it("claim(requestId) returns true on first call", () => {
    expect(cache.claim("req-001")).toBe(true);
  });

  it("claim(requestId) returns false on duplicate within TTL", () => {
    cache.claim("req-002");
    expect(cache.claim("req-002")).toBe(false);
  });

  it("claim(different IDs) returns true for each unique ID", () => {
    expect(cache.claim("req-003")).toBe(true);
    expect(cache.claim("req-004")).toBe(true);
  });

  it("expired entry after TTL is treated as new (returns true again)", () => {
    const originalNow = Date.now;
    const baseTime = Date.now();

    // First claim at t=0
    Date.now = () => baseTime;
    cache.claim("req-005");

    // Second claim at t=TTL+1ms (entry should be expired)
    Date.now = () => baseTime + 10 * 60 * 1000 + 1;
    const result = cache.claim("req-005");
    expect(result).toBe(true); // expired, treated as new

    // Restore
    Date.now = originalNow;
  });
});
