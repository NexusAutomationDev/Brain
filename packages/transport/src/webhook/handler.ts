import { Hono } from "hono";
import { ConfigurationError, BrainOutputValidationError } from "@brain-pkg/shared";
import { createLogger } from "@brain-pkg/observability";
import type { ITransport, TransportStatus } from "../interface.js";
import { BrainEventSchema } from "./events.js";
import type { BrainEvent } from "./events.js";

const logger = createLogger();

/**
 * T-3-04-03: Local interface to avoid circular dependency.
 * packages/core imports from @brain-pkg/transport (for BrainEvent).
 * If handler.ts imported from @brain-pkg/core it would create a cycle:
 *   core → transport → core.
 * D-02: Duck typed to wrapper { brainOutput, tokenUsage } — structurally compatible with BrainRunner.run() return.
 */
export interface IBrainRunnerLike {
  run(event: BrainEvent): Promise<{
    brainOutput: {
      fullResponse: string;
      responseMode: string;
      mediaType?: string;
      mediaUrl?: string;
    };
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  } | null>;
}

/**
 * TRP-02, D-04, D-08: Creates the Hono app with the POST /api/v1/webhook route.
 *
 * Security (T-05-01, ASVS V5): BrainEvent body validated with zod safeParse.
 * Security (T-05-03): Internal state (thread_id, checkpoint data) NEVER returned in response.
 * Security (T-vcu-01): Bearer token authentication via WEBHOOK_TOKEN env var.
 * Security (T-vcu-03): Fail-closed — 503 when WEBHOOK_TOKEN not configured.
 * D-03: X-Request-Id dedup REMOVIDO — header não é mais obrigatório nem verificado.
 *
 * @param runner - Optional BrainRunner-compatible instance. If provided, events are
 *   dispatched to the runner and the reply is returned. If absent, returns { status: "accepted" }
 *   (fallback — should not occur in production after WebhookTransport.start() validation).
 */
export function createWebhookApp(runner?: IBrainRunnerLike): Hono {
  const app = new Hono();

  app.post("/api/v1/webhook", async (c) => {
    // T-vcu-03: Fail-closed — reject all requests when token not configured
    const webhookToken = process.env.WEBHOOK_TOKEN;
    if (!webhookToken) {
      return c.json({ error: "Service unavailable — webhook not configured" }, 503);
    }

    // T-vcu-01: Verify Authorization: Bearer <token> header
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!bearer || bearer !== webhookToken) {
      // T-vcu-02: Log attempt without revealing received token value
      logger.warn({}, "/api/v1/webhook unauthorized attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

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
      try {
        const result = await runner.run(event);
        // LEAD-03: runner.run() retorna null quando ia_ativada=false
        if (result === null) {
          return c.json({ status: "ignored" }, 200);
        }
        // D-01 (Fase 12): retornar BrainOutput completo — fullResponse, responseMode, mediaType?, mediaUrl?
        // D-02 (Fase 12): campo 'reply' removido — breaking change intencional; downstream deve usar fullResponse
        // D-09: incluir tokenUsage na resposta HTTP — sempre presente (D-05 garante zeros quando provider não reporta)
        const { brainOutput, tokenUsage } = result;
        return c.json({
          status: "ok",
          fullResponse: brainOutput.fullResponse,
          responseMode: brainOutput.responseMode,
          ...(brainOutput.mediaType && { mediaType: brainOutput.mediaType }),
          ...(brainOutput.mediaUrl && { mediaUrl: brainOutput.mediaUrl }),
          tokenUsage,
        });
      } catch (err) {
        // Log internally but never surface internals to the caller
        if (err instanceof BrainOutputValidationError) {
          logger.error({ err }, "BrainOutput contract violation — Brain node did not set brainOutput");
          return c.json({ error: "Brain output error" }, 502);
        }
        logger.error({ err }, "BrainRunner.run() failed");
        return c.json({ error: "Internal error" }, 500);
      }
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
  // D-03/IN-03: tracks whether .stop() has been called — getStatus() must reflect this.
  private stopped = false;

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
    this.stopped = false;
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
    this.stopped = true;
  }

  /**
   * D-03/IN-03/TECH-06: getStatus() now reflects stop() — connected:false once .stop()
   * has been called. Before the first stop() (including before start()), connected:true
   * (unchanged baseline — HTTP server accepting requests is the default assumption).
   */
  getStatus(): TransportStatus {
    return { type: 'webhook', connected: !this.stopped };
  }
}
