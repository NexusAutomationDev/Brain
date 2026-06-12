import { Hono } from "hono";
import type { ITransport } from "../interface.js";
import { DedupCache } from "./dedup.js";
import { BrainEventSchema } from "./events.js";
import type { BrainEvent } from "./events.js";

/**
 * TRANS-02, D-04: Creates the Hono app with the POST /api/v1/webhook route.
 *
 * Security (T-2-02, ASVS V5): BrainEvent body validated with zod safeParse.
 * Security (T-2-04): thread_id (if present in event) is NEVER returned in response.
 * Security (T-2-01): X-Request-Id TTL dedup prevents replay attacks.
 */
export function createWebhookApp(): Hono {
  const app = new Hono();
  const cache = new DedupCache(); // one cache per app instance — safe for tests (fresh per beforeEach)

  app.post("/api/v1/webhook", async (c) => {
    const requestId = c.req.header("X-Request-Id");

    if (!requestId) {
      return c.json({ error: "X-Request-Id header required" }, 400);
    }

    if (!cache.claim(requestId)) {
      return c.json({ error: "Duplicate request" }, 409);
    }

    // T-2-02: Validate body structure before any processing
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = BrainEventSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid BrainEvent", details: parsed.error.flatten() }, 400);
    }

    const _event: BrainEvent = parsed.data;
    // Event dispatching will be wired in Phase 3 (BrainRunner)
    // T-2-04: Do NOT return thread_id or session internals in response
    return c.json({ status: "accepted" }, 200);
  });

  return app;
}

/**
 * TRANS-01: WebhookTransport implements ITransport.
 * Wraps the Hono app with start/stop lifecycle.
 */
export class WebhookTransport implements ITransport {
  private server: ReturnType<typeof Bun.serve> | undefined;

  async start(port = 3000): Promise<void> {
    const app = createWebhookApp();
    this.server = Bun.serve({
      port,
      fetch: app.fetch,
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
  }
}
