// D-05: Startup sequencial:
// 1. runner.init() — runMigrations() + carrega prompts + compila graph (exit 1 se falhar)
// 2. Bun.serve(...)  — só sobe após os passos anteriores com sucesso
//
// MIGRATIONS_FOLDER ENV deve apontar para packages/database/src/migrations
// Em Docker: MIGRATIONS_FOLDER=/app/migrations (via ENV no Dockerfile)
// Em dev: definir em .env ou usar path relativo

import postgres from "postgres";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";
import { createLogger } from "@brain-pkg/observability";
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

  // Passo 1: Inicializa BrainRunner — runMigrations() é chamado dentro de runner.init() (D-10)
  // MIGRATIONS_FOLDER deve estar definida no .env ou via ENV do container
  // runner.init() chama process.exit(1) internamente se migration falhar ou promptKey faltando
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
