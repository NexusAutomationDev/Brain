// D-10: TenantPoolManager ativado no entrypoint — zero mudança no SDK (packages/core)
// D-11: 1 instância = 1 cliente — DATABASE_NAME é fixo por instância Docker via ENV
// D-12: ENVs obrigatórias: DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
//        + DATABASE_URL para PostgresSaver interno do BrainRunner
//
// Startup sequencial:
// 1. Validar ENVs — process.exit(1) se qualquer uma estiver ausente
// 2. TenantPoolManager.getPool(DATABASE_NAME) — cria pool para o banco do cliente
// 3. toolsRegistry.enableTool("sdr", "qualify_lead") — registra brainType + tool
// 4. runner.init() — runMigrations() + carrega prompts + compila graph
// 5. Bun.serve(...) — só sobe após os passos anteriores com sucesso

import { TenantPoolManager } from "@brain-pkg/database";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";
import { createLogger } from "@brain-pkg/observability";
import { createTransport } from "@brain-pkg/transport";
import { createServer } from "./server.js";
import { sdrBrain } from "./brain.js";

const logger = createLogger();

async function main() {
  // D-12: Validar ENVs obrigatórias do TenantPoolManager — fail-fast (process.exit(1))
  // T-09-03-05: logger.error não loga valores de DATABASE_PASSWORD — apenas o nome da ENV
  const {
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE_USER,
    DATABASE_PASSWORD,
    DATABASE_NAME,
    DATABASE_URL,
  } = process.env;

  if (!DATABASE_HOST || !DATABASE_PORT || !DATABASE_USER || !DATABASE_PASSWORD || !DATABASE_NAME) {
    logger.error(
      {},
      "Missing required DATABASE_* env vars for TenantPoolManager (DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME)"
    );
    process.exit(1);
  }

  // DATABASE_URL ainda necessário para PostgresSaver interno do BrainRunner._compileGraph()
  if (!DATABASE_URL) {
    logger.error({}, "DATABASE_URL not set — required for PostgresSaver (BrainRunner internal)");
    process.exit(1);
  }

  // D-10: TenantPoolManager cria pool de conexões para o DATABASE_NAME desta instância
  // D-11: getPool(DATABASE_NAME) — 1 instância = 1 banco do cliente
  // T-09-03-03: max: 10, idle_timeout: 300 — limita conexões por instância
  const tenantPoolManager = new TenantPoolManager({
    host: DATABASE_HOST,
    port: parseInt(DATABASE_PORT, 10),
    username: DATABASE_USER,
    password: DATABASE_PASSWORD,
    max: 10,
    idle_timeout: 300,
  });
  const sql = tenantPoolManager.getPool(DATABASE_NAME);

  // ToolsRegistry: habilitar qualify_lead para brainType "sdr"
  // enableTool() cria o brainType se não existir — registerBrainType() é opcional (registry.ts)
  // CRITICAL: se "sdr" não estiver registrado quando getTools() for chamado, lança ConfigurationError
  const toolsRegistry = new ToolsRegistry();
  toolsRegistry.enableTool("sdr", "qualify_lead");

  const runner = new BrainRunner({ brain: sdrBrain, sql, toolsRegistry });
  await runner.init();
  // T-09-03-06: log explícito de "BrainRunner initialized" + porta para rastreabilidade de startup
  logger.info({}, "BrainRunner initialized");

  const app = createServer(sql, runner);
  const port = parseInt(process.env.PORT || "3000", 10);

  Bun.serve({ port, fetch: app.fetch });
  logger.info({ port }, "brain-sdr server listening");

  // TRP-06: start RabbitMQ consumer when TRANSPORT=rabbitmq
  // Webhook mode is handled by the Hono server above (POST /api/v1/webhook route).
  // RabbitMQ mode starts a consumer in addition to the health/core HTTP server.
  const transportType = process.env.TRANSPORT ?? "webhook";
  if (transportType === "rabbitmq") {
    const transport = createTransport(runner);
    await transport.start();
    logger.info({ transport: transportType }, "RabbitMQ transport started");
  }
}

main();
