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
  // D-06 (Fase 12): registrar standard tools no ToolsRegistry — evita ConfigurationError e respeita BRAIN_TOOLS ENV
  // NOTA: sdrBrain.tools[] NÃO inclui estas tools (D-05) — o registro aqui é apenas para o ToolsRegistry
  toolsRegistry.enableTool("sdr", "pause_session");
  toolsRegistry.enableTool("sdr", "finish_conversation");
  toolsRegistry.enableTool("sdr", "search_knowledge"); // D-12/RAG-02: habilita tool RAG para brain-sdr

  const runner = new BrainRunner({ brain: sdrBrain, sql, toolsRegistry });
  await runner.init();
  // T-09-03-06: log explícito de "BrainRunner initialized" + porta para rastreabilidade de startup
  logger.info({}, "BrainRunner initialized");

  // D-TECH-03: criar transport ANTES de createServer() para que /health possa expor status.
  // createTransport() retorna WebhookTransport ou RabbitMQTransport baseado em TRANSPORT ENV.
  const transport = createTransport(runner);

  // Montar app com transport disponível para /health
  const app = createServer(sql, runner, transport);
  const port = parseInt(process.env.PORT || "3000", 10);

  // Iniciar servidor HTTP (Bun.serve para o Hono app — sempre necessário para /health e /webhook)
  Bun.serve({ port, fetch: app.fetch });
  logger.info({ port }, "brain-sdr server listening");

  // Iniciar transport:
  // - TRANSPORT=webhook: WebhookTransport.start() cria um Bun.serve próprio — conflitaria com o
  //   Bun.serve acima (mesma porta). Em modo webhook o servidor HTTP acima já serve /api/v1/webhook
  //   via createWebhookApp(runner). Transport criado apenas para getStatus() no /health.
  // - TRANSPORT=rabbitmq: RabbitMQTransport.start() conecta ao broker e inicia consumer.
  //   Requer start() explícito pois não usa HTTP — é um consumer de fila separado.
  const transportType = process.env.TRANSPORT ?? "webhook";
  if (transportType === "rabbitmq") {
    await transport.start();
    logger.info({ transport: transportType }, "transport started");
  } else {
    logger.info({ transport: transportType }, "transport ready (webhook uses HTTP server above)");
  }
}

main();
