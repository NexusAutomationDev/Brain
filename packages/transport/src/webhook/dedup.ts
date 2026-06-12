/**
 * TRANS-03, D-03: In-memory TTL dedup cache.
 *
 * Uses a Map<requestId, timestamp> with TTL eviction on write.
 * TTL = 10 minutes (Claude's discretion from D-03 "5-10 min").
 * Evict-on-write avoids setInterval timer management.
 *
 * State is lost on process restart — acceptable for v1 (SC-3 does not require durability).
 */
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export class DedupCache {
  private cache = new Map<string, number>();

  /**
   * Returns true if requestId is new (first time seen — should process).
   * Returns false if requestId is a duplicate within TTL (should return 409).
   */
  claim(requestId: string): boolean {
    const now = Date.now();

    // Evict expired entries on every write to avoid unbounded growth
    for (const [id, ts] of this.cache) {
      if (now - ts > TTL_MS) this.cache.delete(id);
    }

    if (this.cache.has(requestId)) return false;
    this.cache.set(requestId, now);
    return true;
  }

  /** For testing: clear all entries */
  clear(): void {
    this.cache.clear();
  }
}
