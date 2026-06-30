// D-04: Único Hono app montando 3 sub-apps via app.route('/')
// - createHealthApp(sql, transport?)  → GET /health
// - createWebhookApp(runner)          → POST /api/v1/webhook
// - createCoreApp(runner)             → POST /reload-prompts
// - createIngestApp(sql)              → POST /api/v1/ingest

import { Hono } from "hono";
import { createHealthApp } from "@brain-pkg/observability";
import { createWebhookApp } from "@brain-pkg/transport";
import type { ITransport } from "@brain-pkg/transport";
import { createCoreApp, createIngestApp, type BrainRunner } from "@brain-pkg/core";
import type { Sql } from "postgres";

/**
 * Cria o Hono app principal do SDR Brain.
 * Monta os sub-apps em um único app via app.route('/').
 *
 * @param sql - postgres.js Sql instance para health check
 * @param runner - BrainRunner já inicializado para processar eventos
 * @param transport - ITransport opcional para expor status no GET /health (D-14/TECH-03)
 */
export function createServer(sql: Sql, runner: BrainRunner, transport?: ITransport): Hono {
  const app = new Hono();

  // Montar sub-apps — todos na rota raiz '/'
  app.route("/", createHealthApp(sql, transport)); // D-14/TECH-03: transport para /health
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));
  app.route("/", createIngestApp(sql)); // RAG-01/D-05: ingest endpoint

  return app;
}
