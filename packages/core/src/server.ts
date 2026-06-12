// SDK-02: Core HTTP server — exposes POST /reload-prompts for hot-reload of prompts.
// D-07: POST /reload-prompts forces prompt reload without container restart.
// Authentication: X-Admin-Token header vs ADMIN_TOKEN env var.
// Security T-3-04-01: Unauthorized access rejected with 401 before any action.
// Security T-3-04-02: If ADMIN_TOKEN not configured, endpoint returns 503 (fail closed).

import { Hono } from "hono";
import { createLogger } from "@brain-pkg/observability";
import type { BrainRunner } from "./runner/runner.js";

const logger = createLogger();

/**
 * Creates a Hono application exposing the /reload-prompts management endpoint.
 *
 * Security: Requires X-Admin-Token header matching ADMIN_TOKEN env var.
 * If ADMIN_TOKEN env var is not set, the endpoint always returns 503 (misconfiguration).
 *
 * @param runner - BrainRunner instance to call refreshPrompts() on
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

  return app;
}
