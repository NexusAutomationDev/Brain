// D-04: Único Hono app montando 3 sub-apps via app.route('/')
// - createHealthApp(sql)    → GET /health
// - createWebhookApp(runner) → POST /api/v1/webhook
// - createCoreApp(runner)   → POST /reload-prompts

import { Hono } from "hono";
import { createHealthApp } from "@brain-pkg/observability";
import { createWebhookApp } from "@brain-pkg/transport";
import { createCoreApp, createIngestApp, type BrainRunner } from "@brain-pkg/core";
import type { Sql } from "postgres";

/**
 * Cria o Hono app principal do SDR Brain.
 * Monta os 3 sub-apps em um único app via app.route('/').
 *
 * @param sql - postgres.js Sql instance para health check
 * @param runner - BrainRunner já inicializado para processar eventos
 */
export function createServer(sql: Sql, runner: BrainRunner): Hono {
  const app = new Hono();

  // Montar sub-apps — todos na rota raiz '/'
  app.route("/", createHealthApp(sql));
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));
  app.route("/", createIngestApp(sql)); // RAG-01/D-05: ingest endpoint

  return app;
}
