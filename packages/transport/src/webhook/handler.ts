import { Hono } from "hono";
import type { ITransport } from "../interface.js";
import { DedupCache } from "./dedup.js";
import { BrainEventSchema } from "./events.js";
import type { BrainEvent } from "./events.js";

/**
 * T-3-04-03: Local interface to avoid circular dependency.
 * packages/core imports from @brain-pkg/transport (for BrainEvent).
 * If handler.ts imported from @brain-pkg/core it would create a cycle:
 *   core → transport → core.
 * Duck typing: BrainRunner satisfies IBrainRunnerLike structurally.
 */
interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{ reply: string }>;
}

/**
 * TRANS-02, D-04: Creates the Hono app with the POST /api/v1/webhook route.
 *
 * Security (T-2-02, ASVS V5): BrainEvent body validated with zod safeParse.
 * Security (T-2-04): thread_id (if present in event) is NEVER returned in response.
 * Security (T-2-01): X-Request-Id TTL dedup prevents replay attacks.
 *
 * @param runner - Optional BrainRunner-compatible instance. If provided, events are
 *   dispatched to the runner and the reply is returned. If absent, returns { status: "accepted" }
 *   (fallback — should not occur in production).
 */
export function createWebhookApp(runner?: IBrainRunnerLike): Hono {
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

    const event: BrainEvent = parsed.data;

    // Phase 3 wiring: dispatch to BrainRunner if provided
    // T-2-04: Do NOT return thread_id or session internals in response
    if (runner) {
      const result = await runner.run(event);
      return c.json({ status: "ok", reply: result.reply });
    }

    // Fallback: runner not injected (should not occur in production)
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
