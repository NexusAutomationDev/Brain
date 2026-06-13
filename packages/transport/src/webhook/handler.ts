import { Hono } from "hono";
import { ConfigurationError } from "@brain-pkg/shared";
import type { ITransport } from "../interface.js";
import { BrainEventSchema } from "./events.js";
import type { BrainEvent } from "./events.js";

/**
 * T-3-04-03: Local interface to avoid circular dependency.
 * packages/core imports from @brain-pkg/transport (for BrainEvent).
 * If handler.ts imported from @brain-pkg/core it would create a cycle:
 *   core → transport → core.
 * Duck typing: BrainRunner satisfies IBrainRunnerLike structurally.
 */
export interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{ reply: string }>;
}

/**
 * TRP-02, D-04, D-08: Creates the Hono app with the POST /api/v1/webhook route.
 *
 * Security (T-05-01, ASVS V5): BrainEvent body validated with zod safeParse.
 * Security (T-05-03): Internal state (thread_id, checkpoint data) NEVER returned in response.
 * D-03: X-Request-Id dedup REMOVIDO — header não é mais obrigatório nem verificado.
 *
 * @param runner - Optional BrainRunner-compatible instance. If provided, events are
 *   dispatched to the runner and the reply is returned. If absent, returns { status: "accepted" }
 *   (fallback — should not occur in production after WebhookTransport.start() validation).
 */
export function createWebhookApp(runner?: IBrainRunnerLike): Hono {
  const app = new Hono();

  app.post("/api/v1/webhook", async (c) => {
    // T-05-01: Validate body structure before any processing
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

    // Dispatch to BrainRunner if provided
    // T-05-03: Do NOT return thread_id or session internals in response
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
 * TRANS-01, D-05, D-06: WebhookTransport implements ITransport.
 * Wraps the Hono app with start/stop lifecycle.
 *
 * T-05-02: ConfigurationError lançada em start() se runner ausente —
 * impede servidor aceitar requests em estado não configurado (GAP-1 fix).
 */
export class WebhookTransport implements ITransport {
  private server: ReturnType<typeof Bun.serve> | undefined;

  constructor(private readonly runner?: IBrainRunnerLike) {}

  async start(port = 3000): Promise<void> {
    // T-05-02, D-06: Fail-fast if runner not injected — prevents silent accept without processing
    if (!this.runner) {
      throw new ConfigurationError(
        "WebhookTransport requires a runner — inject via constructor: new WebhookTransport(runner)",
        { transport: "webhook" }
      );
    }

    const app = createWebhookApp(this.runner);
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
