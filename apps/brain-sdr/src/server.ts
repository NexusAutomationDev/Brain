// D-04: Único Hono app montando sub-apps via app.route('/')
// - createHealthApp(sql, transport?)  → GET /health
// - createWebhookApp(runner)          → POST /api/v1/webhook
// - createCoreApp(runner)             → POST /reload-prompts
// - createIngestApp(sql)              → POST /api/v1/ingest
// - createReembedApp(sql)             → POST /api/v1/reembed

import { Hono } from "hono";
import { createHealthApp } from "@brain-pkg/observability";
import { createWebhookApp } from "@brain-pkg/transport";
import type { ITransport } from "@brain-pkg/transport";
import { createCoreApp, createIngestApp, createReembedApp, type BrainRunner } from "@brain-pkg/core";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import type { Sql } from "postgres";

/**
 * Cria o Hono app principal do SDR Brain.
 * Monta os sub-apps em um único app via app.route('/').
 *
 * @param sql - postgres.js Sql instance para health check
 * @param runner - BrainRunner já inicializado para processar eventos
 * @param transport - ITransport opcional para expor status no GET /health (D-14/TECH-03)
 * @param embeddingProvider - IEmbeddingProvider opcional (D-02) — quando ausente, /api/v1/ingest e
 *   /api/v1/reembed não são montados
 */
export function createServer(
  sql: Sql,
  runner: BrainRunner,
  transport?: ITransport,
  embeddingProvider?: IEmbeddingProvider
): Hono {
  const app = new Hono();

  // Montar sub-apps — todos na rota raiz '/'
  app.route("/", createHealthApp(sql, transport)); // D-14/TECH-03: transport para /health
  app.route("/", createWebhookApp(runner));
  app.route("/", createCoreApp(runner));
  if (embeddingProvider) {
    app.route("/", createIngestApp(sql, embeddingProvider)); // RAG-01/D-05: ingest endpoint
    app.route("/", createReembedApp(sql, embeddingProvider)); // D-16: batch re-embed tool
  }

  return app;
}
