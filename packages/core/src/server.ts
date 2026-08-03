// SDK-02: Core HTTP server — exposes POST /reload-prompts for hot-reload of prompts
// and POST /debug/inject-message to inject a synthetic AIMessage into a thread checkpoint.
// D-07: POST /reload-prompts forces prompt reload without container restart.
// D-2/D-3 (quick-260803-g4j): POST /debug/inject-message injects a debug AIMessage via
// BrainRunner.injectMessage() — same auth model as /reload-prompts.
// Authentication: X-Admin-Token header vs ADMIN_TOKEN env var.
// Security T-3-04-01: Unauthorized access rejected with 401 before any action.
// Security T-3-04-02: If ADMIN_TOKEN not configured, endpoint returns 503 (fail closed).

import { Hono } from "hono";
import { createLogger } from "@brain-pkg/observability";
import type { BrainRunner } from "./runner/runner.js";

const logger = createLogger();

/**
 * Creates a Hono application exposing the /reload-prompts and /debug/inject-message
 * management endpoints.
 *
 * Security: Requires X-Admin-Token header matching ADMIN_TOKEN env var.
 * If ADMIN_TOKEN env var is not set, the endpoint always returns 503 (misconfiguration).
 *
 * @param runner - BrainRunner instance to call refreshPrompts()/injectMessage() on
 */
export function createCoreApp(runner: BrainRunner): Hono {
  const app = new Hono();

  app.post("/reload-prompts", async (c) => {
    const adminToken = process.env.ADMIN_TOKEN;

    // SECURITY T-3-04-02: Fail closed if ADMIN_TOKEN is not configured
    if (!adminToken) {
      logger.warn({}, "/reload-prompts called but ADMIN_TOKEN env var is not set");
      return c.json({ error: "Service unavailable — management endpoint not configured" }, 503);
    }

    const token = c.req.header("X-Admin-Token");

    // SECURITY T-3-04-01: Reject unauthorized requests
    // Do NOT reveal whether token is missing vs incorrect (prevents timing/info disclosure)
    if (!token || token !== adminToken) {
      logger.warn({}, "/reload-prompts unauthorized attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    await runner.refreshPrompts();
    logger.info({}, "/reload-prompts completed — prompts reloaded and graph recompiled");
    return c.json({ status: "ok" });
  });

  // D-2/D-3 (quick-260803-g4j): POST /debug/inject-message — injects a synthetic AIMessage
  // into a thread's LangGraph checkpoint, without invoking the graph or calling the LLM.
  app.post("/debug/inject-message", async (c) => {
    const adminToken = process.env.ADMIN_TOKEN;

    // SECURITY T-3-04-02: Fail closed if ADMIN_TOKEN is not configured
    if (!adminToken) {
      logger.warn({}, "/debug/inject-message called but ADMIN_TOKEN env var is not set");
      return c.json({ error: "Service unavailable — management endpoint not configured" }, 503);
    }

    const token = c.req.header("X-Admin-Token");

    // SECURITY T-3-04-01: Reject unauthorized requests
    // Do NOT reveal whether token is missing vs incorrect (prevents timing/info disclosure)
    if (!token || token !== adminToken) {
      logger.warn({}, "/debug/inject-message unauthorized attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.threadId !== "string" ||
      body.threadId.trim() === "" ||
      typeof body.content !== "string" ||
      body.content.trim() === ""
    ) {
      return c.json({ error: "threadId and content must be non-empty strings" }, 400);
    }

    await runner.injectMessage(body.threadId, body.content);
    // SECURITY: never log body.content — arbitrary admin-supplied text
    logger.info({ threadId: body.threadId }, "/debug/inject-message completed — message injected");
    return c.json({ status: "ok" });
  });

  return app;
}
