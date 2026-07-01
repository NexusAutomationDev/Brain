// D-10/D-11/D-12 (herdado de brain-sdr): TenantPoolManager ativado no entrypoint — zero
// mudança no SDK (packages/core). 1 instância = 1 cliente — DATABASE_NAME é fixo por
// instância Docker via ENV. ENVs obrigatórias: DATABASE_HOST, DATABASE_PORT, DATABASE_USER,
// DATABASE_PASSWORD, DATABASE_NAME + DATABASE_URL para PostgresSaver interno do BrainRunner.
//
// SUP-08: ToolsRegistry registra "support" com pause_session, finish_conversation e
// search_knowledge — sem tool de qualificação de lead (esta tool não existe para Brain Suporte).
//
// Startup sequencial:
// 1. Validar ENVs — process.exit(1) se qualquer uma estiver ausente
// 2. TenantPoolManager.getPool(DATABASE_NAME) — cria pool para o banco do cliente
// 3. toolsRegistry.enableTool("support", ...) — registra brainType + tools
// 4. runner.init() — runMigrations() + carrega prompts + compila graph
// 5. Bun.serve(...) — só sobe após os passos anteriores com sucesso

import { TenantPoolManager } from "@brain-pkg/database";
import { BrainRunner, ToolsRegistry } from "@brain-pkg/core";
import { createEmbeddingProvider } from "@brain-pkg/embeddings";
import { createLogger } from "@brain-pkg/observability";
import { createTransport } from "@brain-pkg/transport";
import { createServer } from "./server.js";
import { supportBrain } from "./brain.js";

const logger = createLogger();

async function main() {
  // Validar ENVs obrigatórias do TenantPoolManager — fail-fast (process.exit(1))
  // T-29-03: logger.error não loga valores de DATABASE_PASSWORD — apenas o nome da ENV
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

  // TenantPoolManager cria pool de conexões para o DATABASE_NAME desta instância
  // 1 instância = 1 banco do cliente
  const tenantPoolManager = new TenantPoolManager({
    host: DATABASE_HOST,
    port: parseInt(DATABASE_PORT, 10),
    username: DATABASE_USER,
    password: DATABASE_PASSWORD,
    max: 10,
    idle_timeout: 300,
  });
  const sql = tenantPoolManager.getPool(DATABASE_NAME);

  // SUP-08: ToolsRegistry — habilitar tools para brainType "support"
  // enableTool() cria o brainType se não existir.
  // CRITICAL: se "support" não estiver registrado quando getTools() for chamado, lança ConfigurationError
  // Sem tool de qualificação de lead — esta tool não existe para Brain Suporte (D-01/D-06).
  const toolsRegistry = new ToolsRegistry();
  toolsRegistry.enableTool("support", "pause_session");
  toolsRegistry.enableTool("support", "finish_conversation");
  toolsRegistry.enableTool("support", "search_knowledge");

  const runner = new BrainRunner({ brain: supportBrain, sql, toolsRegistry });
  await runner.init();
  logger.info({}, "BrainRunner initialized");

  // criar transport ANTES de createServer() para que /health possa expor status.
  // createTransport() retorna WebhookTransport ou RabbitMQTransport baseado em TRANSPORT ENV.
  const transport = createTransport(runner);

  // resolve o IEmbeddingProvider uma única vez no startup. Injetado em createServer()
  // para montar /api/v1/ingest.
  const embeddingProvider = await createEmbeddingProvider();

  // Montar app com transport e embeddingProvider disponíveis
  const app = createServer(sql, runner, transport, embeddingProvider);
  const port = parseInt(process.env.PORT || "3000", 10);

  // Iniciar servidor HTTP (Bun.serve para o Hono app — sempre necessário para /health e /webhook)
  Bun.serve({ port, fetch: app.fetch });
  logger.info({ port }, "brain-support server listening");

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
