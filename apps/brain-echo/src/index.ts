// D-05: Startup sequencial:
// 1. runMigrations(sql, migrationsDir) — aplica migrations + seed (exit 1 se falhar)
// 2. runner.init()                     — carrega prompts + compila graph (exit 1 se prompt faltando)
// 3. Bun.serve(...)                    — só sobe após os passos anteriores com sucesso

import postgres from "postgres";
import { runMigrations } from "@brain-pkg/database";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";
import { createLogger } from "@brain-pkg/observability";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { createServer } from "./server.js";
import { echoBrain } from "./brain.js";

const logger = createLogger();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error({}, "DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 10, idle_timeout: 300 });

  // Passo 1: Migrations + seed de prompts
  // Path resolvido em relação ao arquivo compilado para funcionar no Docker.
  // Em desenvolvimento, as migrations ficam em packages/database/src/migrations/
  // No container: ENV MIGRATIONS_DIR=/app/migrations (ver plano 04-02)
  const migrationsDir = process.env.MIGRATIONS_DIR
    ?? join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

  await runMigrations(sql, migrationsDir).catch((err) => {
    logger.error({ err }, "Migrations failed — aborting startup");
    process.exit(1);
  });
  logger.info({}, "Migrations completed");

  // Passo 2: Inicializa BrainRunner
  // runner.init() chama process.exit(1) internamente se promptKey 'system' não existir no DB
  const toolsRegistry = new ToolsRegistry();
  // D-02: EchoBrain tem tools: [] — registrar o brainType sem tools para satisfazer o ToolsRegistry
  toolsRegistry.registerBrainType(echoBrain.brainType);
  const runner = new BrainRunner({ brain: echoBrain, sql, toolsRegistry });
  await runner.init();
  logger.info({}, "BrainRunner initialized");

  // Passo 3: Montar Hono app + iniciar servidor
  const app = createServer(sql, runner);
  const port = parseInt(process.env.PORT || "3000", 10);

  Bun.serve({ port, fetch: app.fetch });
  logger.info({ port }, "brain-echo server listening");
}

main();
