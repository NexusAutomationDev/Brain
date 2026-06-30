// SDK-02: BrainRunner — host that orchestrates a complete conversation turn.
// D-12: run() returns { brainOutput, tokenUsage } | null — wrapper with structured output + token consumption.
// D-06: Lifecycle: new BrainRunner({...}) sync → await runner.init() async → runner.run(event) per request.
// D-06: init() fails with process.exit(1) if any promptKey is missing — fail-fast startup pattern.
// D-07: refreshPrompts() reloads prompts AND recompiles graph (prompts are snapshot in buildGraph closure).
// AI-01: PostgresSaver ONLY in production — see packages/ai/src/graph/checkpointer.ts.
// Anti-pattern: NEVER call .compile() inside buildGraph() — BrainRunner owns compilation.

import { createCheckpointer, createLLM } from "@brain-pkg/ai";
import type { LLMOptions } from "@brain-pkg/ai";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { runMigrations } from "@brain-pkg/database";
import { MemoryManager } from "@brain-pkg/memory";
import { createTracingCallbacks } from "@brain-pkg/observability";
import { createLogger } from "@brain-pkg/observability";
import { ConfigurationError, BrainOutputValidationError } from "@brain-pkg/shared";
import type { BrainOutput, TokenUsage } from "@brain-pkg/shared";
import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BrainEvent } from "@brain-pkg/transport";
import type { Sql } from "postgres";
import type { IBrain, BrainBuildContext } from "../brain/interface.js";
import { ToolsRegistry } from "../tools/registry.js";
import { loadPrompts, upsertPrompts } from "../prompts/loader.js";
import { LeadService } from "../leads/lead-service.js";
import type { Lead } from "../leads/lead-service.js";
import { BrainOutputSchema } from "../output/schema.js";
import type { IEventPublisher, ToolEvent } from "../events/event-publisher.js";
import { EventPublisher } from "../events/event-publisher.js";
import type { IFupScheduler } from "../fup/fup-scheduler.js";
import { FupScheduler } from "../fup/fup-scheduler.js";

// EVT-02: Whitelist hardcoded como constante de módulo — LLM não pode injetar novo nome via prompt injection (T-20-07)
const TOOL_EVENTS_WHITELIST = new Set([
  "qualify_lead",
  "pause_session",
  "finish_conversation",
]);

/** Options for constructing a BrainRunner */
export interface BrainRunnerOptions {
  /** The IBrain implementation to host */
  brain: IBrain;
  /** postgres.js Sql instance for DB access (prompts + memory) */
  sql: Sql;
  /** ToolsRegistry — controls which tools are available for this brain's brainType */
  toolsRegistry: ToolsRegistry;
  /** LLM options for createLLM() — provider and model from env */
  llmOptions?: LLMOptions;
  /** Pasta de migrations para auto-migrate no init(). Se omitido, usa MIGRATIONS_FOLDER ENV. */
  migrationsFolder?: string;
  /** EventPublisher injetável para testes (D-11). Ausente = criado em init() a partir de ENVs. */
  eventPublisher?: IEventPublisher;
}


/**
 * SDK-02: BrainRunner — orchestrates the full conversation turn lifecycle.
 *
 * Lifecycle:
 *   1. new BrainRunner(options) — synchronous construction
 *   2. await runner.init()     — loads prompts, compiles graph; exits on missing promptKey
 *   3. await runner.run(event) — per-request: hydrate → invoke → extract reply → persist
 */
export class BrainRunner {
  private readonly brain: IBrain;
  private readonly sql: Sql;
  private readonly toolsRegistry: ToolsRegistry;
  private readonly llmOptions?: LLMOptions;
  private readonly migrationsFolder: string | undefined;
  private readonly logger = createLogger();

  private prompts: Record<string, string> = {};
  // AI-01: compiledGraph uses PostgresSaver (createCheckpointer) in production.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private compiledGraph: any | null = null;
  private memoryManager: MemoryManager | null = null;
  private mcpClient: MultiServerMCPClient | null = null;
  private eventPublisher: IEventPublisher | null = null;
  private fupScheduler: IFupScheduler | null = null;
  // FUP-03/D-12: checkpointer salvo como campo para injeção no FupScheduler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private checkpointer: any | null = null;
  private leadService!: LeadService; // inicializado no construtor
  // MCP session TTL: n8n fecha a sessão após inatividade; recompilamos antes de expirar.
  // Configurável via MCP_SESSION_TTL_MS ENV (default: 4 min).
  private mcpInitTime = 0;
  private readonly mcpSessionTtlMs =
    parseInt(process.env.MCP_SESSION_TTL_MS ?? "240000", 10);

  // WR-03: Salvo como campo para remoção em close() — evita acúmulo de listeners em
  // chamadas múltiplas de init() (ex: testes ou reinicializações).
  private _sigtermHandler: (() => Promise<void>) | null = null;

  constructor(options: BrainRunnerOptions) {
    this.brain = options.brain;
    this.sql = options.sql;
    this.toolsRegistry = options.toolsRegistry;
    this.llmOptions = options.llmOptions;
    this.migrationsFolder = options.migrationsFolder;
    this.leadService = new LeadService(options.sql);
    // D-11: EventPublisher injetável para testes; null = criado em init() a partir de ENVs
    if (options.eventPublisher) {
      this.eventPublisher = options.eventPublisher;
    }
  }

  /**
   * D-06: Initialize the runner — load prompts, compile graph.
   * Calls process.exit(1) if any promptKey is missing from the database.
   * This enforces the fail-fast startup pattern (aligns with migrate.ts behavior).
   *
   * Must be called once after construction, before any run() calls.
   */
  async init(): Promise<void> {
    this.logger.info(
      { brainId: this.brain.id, brainType: this.brain.brainType },
      "BrainRunner initializing"
    );

    // D-10: runMigrations() chamada dentro de BrainRunner.init() — SDK cuida automaticamente
    // D-11: MIGRATIONS_FOLDER via ENV ou opção do construtor
    // D-12: migration completa antes do Brain aceitar mensagens
    const migrationsFolder = this.migrationsFolder ?? process.env.MIGRATIONS_FOLDER;
    if (!migrationsFolder) {
      this.logger.error(
        { brainId: this.brain.id },
        'MIGRATIONS_FOLDER not set — cannot run migrations'
      );
      process.exit(1);
    }
    await runMigrations(this.sql, migrationsFolder).catch((err: unknown) => {
      this.logger.error({ brainId: this.brain.id, err }, 'Migrations failed — aborting init');
      process.exit(1);
    });
    this.logger.info({ brainId: this.brain.id }, 'Migrations completed');

    this.prompts = await loadPrompts(this.sql, this.brain.brainType, this.brain.promptKeys);

    // D-06: Validate ALL prompt keys exist — fail-fast if any missing
    for (const key of this.brain.promptKeys) {
      if (!(key in this.prompts)) {
        this.logger.error(
          { brainId: this.brain.id, brainType: this.brain.brainType, missingKey: key },
          "Missing prompt key — cannot start Brain"
          // SECURITY: do NOT log the content of other prompts here (info disclosure)
        );
        process.exit(1);
      }
    }

    await this._compileGraph();

    // EVT-01: Inicializar EventPublisher se ENVs configuradas (D-11: skip se já injetado)
    if (!this.eventPublisher) {
      const hasQueue = !!process.env.TOOL_EVENTS_QUEUE?.trim();
      const hasUrl = !!process.env.TOOL_EVENTS_URL?.trim();
      if (hasQueue || hasUrl) {
        const publisher = new EventPublisher();
        await publisher.init();
        this.eventPublisher = publisher;
      }
    }

    // FUP-01 a FUP-08: Inicializar FupScheduler se FUP_WEBHOOK_URL configurado (D-02, D-04)
    const fupWebhookUrl = process.env.FUP_WEBHOOK_URL?.trim();
    if (fupWebhookUrl && this.checkpointer) {
      this.fupScheduler = new FupScheduler({
        sql: this.sql,
        brainType: this.brain.brainType,
        checkpointer: this.checkpointer,
        eventPublisher: this.eventPublisher,
        fupWebhookUrl,
      });
      await this.fupScheduler.start();
      // T-22-04: logar apenas presença (hasFupUrl: true), nunca a URL
      this.logger.info(
        { brainId: this.brain.id, brainType: this.brain.brainType, hasFupUrl: true },
        "FupScheduler started"
      );
    } else if (fupWebhookUrl && !this.checkpointer) {
      // WR-01: Visibilidade operacional — checkpointer null impede FupScheduler de iniciar.
      // Sem esse log, operador configura FUP_WEBHOOK_URL e não recebe nenhum feedback.
      this.logger.warn(
        { brainType: this.brain.brainType, hasFupUrl: true },
        "FupScheduler not started — checkpointer unavailable"
      );
    }

    // D-05, MCP-05: Auto-registrar SIGTERM handler — SDK cuida do shutdown transparentemente.
    // Registrado APÓS _compileGraph() para garantir que mcpClient está pronto quando SIGTERM chegar.
    // Apps (index.ts) NÃO precisam adicionar SIGTERM handlers.
    // WR-03: handler salvo como campo para remoção em close() — evita acúmulo de listeners
    this._sigtermHandler = async () => {
      this.logger.info({ brainId: this.brain.id }, 'SIGTERM received — shutting down cleanly');
      await this.close();
      process.exit(0);
    };
    process.on('SIGTERM', this._sigtermHandler);

    this.logger.info({ brainId: this.brain.id }, "BrainRunner initialized");
  }

  /**
   * D-07: Reload prompts from DB and recompile the graph.
   * Called by POST /reload-prompts handler.
   * Recompilation is required because buildGraph() receives a snapshot of prompts —
   * closures inside graph nodes capture values at compile time.
   */
  async refreshPrompts(): Promise<void> {
    this.logger.info({ brainId: this.brain.id }, "Refreshing prompts");
    // D-07: If Brain defines defaultPrompts, upsert them to DB before reloading.
    // This lets code be the source of truth: modify defaultPrompts → deploy → call /reload-prompts.
    if (this.brain.defaultPrompts) {
      await upsertPrompts(this.sql, this.brain.brainType, this.brain.defaultPrompts);
    }
    this.prompts = await loadPrompts(this.sql, this.brain.brainType, this.brain.promptKeys);
    await this._compileGraph();
    this.logger.info({ brainId: this.brain.id }, "Prompts refreshed and graph recompiled");
  }

  /**
   * D-12: Run a single conversation turn.
   * Returns { brainOutput, tokenUsage } wrapper — structured output + token consumption.
   * Returns null when ia_ativada=false (LEAD-03).
   * Throws BrainOutputValidationError if brainOutput is null or fails BrainOutputSchema.
   *
   * @param event - BrainEvent from transport layer (validated by BrainEventSchema before reaching here)
   */
  async run(event: BrainEvent): Promise<{ brainOutput: BrainOutput; tokenUsage: TokenUsage } | null> {
    if (!this.compiledGraph || !this.memoryManager) {
      throw new ConfigurationError(
        "BrainRunner.init() must be called before run()",
        { brainId: this.brain.id }
      );
    }

    // Reconexão automática de MCP: n8n fecha sessão após inatividade.
    // Se MCP_URL está configurada e a sessão passou do TTL, recompila o grafo
    // para obter um novo mcpClient e tools frescos antes de invocar.
    const hasMcp = !!process.env.MCP_URL?.trim();
    if (hasMcp && this.mcpInitTime > 0 && Date.now() - this.mcpInitTime > this.mcpSessionTtlMs) {
      this.logger.info({ brainId: this.brain.id }, "MCP session TTL exceeded — reconnecting");
      await this._compileGraph();
    }

    // D-06: Fluxo — upsert lead → gate ia_ativada → LLM (LEAD-02, LEAD-03)
    // Phase 25: brainType permite ativação automática de fup_enabled quando fup_config existe
    const lead: Lead = await this.leadService.upsertLead(
      event.Numero,
      event.IDLead,
      event.Name,
      this.brain.brainType // ← NOVO: quarto parâmetro para ativação automática de FUP (Phase 25)
    );

    // D-13, FUP-06: Atualizar last_message_at INCONDICIONALMENTE — antes do gate ia_ativada.
    // FUP-06 exige que last_message_at seja atualizado a cada mensagem recebida,
    // inclusive quando ia_ativada=false (scheduler de FUP precisa saber o último contato).
    await this.leadService.touchLastMessage(lead.uniqueId);

    // FUP-06 / D-19: Cancelar FUPs pendentes quando lead responde.
    // Seta fup_next_at=NULL e fup_step=0. fup_enabled permanece true.
    await this.leadService.resetFup(lead.uniqueId);

    // D-04/D-05: Gate ia_ativada — retorna null silenciosamente (LEAD-03)
    // Segurança: iaAtivada vem do banco (upsert), nunca do payload externo
    if (!lead.iaAtivada) {
      this.logger.debug({ numero: event.Numero }, "ia_ativada=false — ignoring message");
      return null;
    }

    // WR-02: usar lead.uniqueId (IDLead canonical) como thread_id — não event.Numero.
    // lead já está disponível (upsertado acima). Garante que o histórico de conversa
    // fica vinculado ao lead canônico, não ao número de telefone.
    const threadId = lead.uniqueId;

    // HIST-03: Ler tamanho do histórico atual para auditoria/logging.
    // O slice para controlar o contexto enviado ao LLM é feito dentro do nó do grafo.
    // NÃO re-injetar historicalMessages no invoke() — causaria duplicação (Pitfall 1).
    const snapshot = await this.compiledGraph.getState({
      configurable: { thread_id: threadId },
    });
    const historicalMessages: BaseMessage[] = snapshot?.values?.messages ?? [];
    // HIST-03: Log historical message count; slicing is performed inside the graph node.
    this.logger.debug(
      {
        threadId,
        historicalCount: historicalMessages.length,
      },
      "HIST-03: context window snapshot"
    );

    // Step 1: Hydrate memory — retrieve context from all 3 layers (MEM-04)
    // Pass empty queryVector to skip semantic search in v1 (no embedding of input yet)
    // Context flows through the PostgresSaver checkpointer; explicit message injection deferred to Phase 8.
    await this.memoryManager.getContext(threadId, event.IDLead, []);

    // Step 2: Invoke compiled graph with thread_id + Langfuse callbacks
    const callbacks = createTracingCallbacks({
      sessionId: threadId,
      userId: event.IDLead,
      brainId: this.brain.id,
    });

    const result = await this.compiledGraph.invoke(
      {
        messages: [{ role: "human", content: event.Message }],
        userId: event.IDLead,
        sessionId: threadId,
        leadName: lead.nome ?? "",
      },
      {
        configurable: { thread_id: threadId },
        callbacks,
      }
    );

    // EVT-01, EVT-02, EVT-04: Publicar eventos de tools da whitelist (D-01, D-03)
    // Intercepção via result.messages (pós-invoke) — sem callbacks LangGraph, independente de MCP
    if (this.eventPublisher) {
      const toolEvents: ToolEvent[] = [];
      for (const msg of result.messages ?? []) {
        if (
          ToolMessage.isInstance(msg) &&
          typeof msg.name === "string" &&
          TOOL_EVENTS_WHITELIST.has(msg.name)
        ) {
          toolEvents.push({
            event_id: `${threadId}:${msg.tool_call_id}`,
            action: msg.name,
            lead: {
              id: lead.uniqueId,
              nome: lead.nome ?? null,
              numero: lead.numero,
            },
            result:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
            timestamp: new Date().toISOString(),
          });
        }
      }
      // D-08, EVT-01: fire-and-forget — NUNCA await aqui; não bloqueia resposta ao lead
      if (toolEvents.length > 0) {
        this.eventPublisher.publish(toolEvents).catch((err: unknown) => {
          this.logger.warn({ err }, "EventPublisher.publish failed — ignoring (fire-and-forget)");
        });
      }
    }

    // Step 3: Validate structured output (SDK-06, D-12, D-14)
    // O nó do grafo DEVE setar state.brainOutput — BrainRunner valida e lança erro se ausente.
    // Pitfall 3: BrainOutputSchema.parse() lança ZodError — re-lançar como BrainOutputValidationError.
    const rawOutput = result.brainOutput;
    if (rawOutput === null || rawOutput === undefined) {
      throw new BrainOutputValidationError(
        "BrainOutput is null — graph node must set state.brainOutput before '__end__'",
        { brainId: this.brain.id, threadId }
      );
    }

    let brainOutput: BrainOutput;
    try {
      brainOutput = BrainOutputSchema.parse(rawOutput);
    } catch (err) {
      // Re-lançar como BrainOutputValidationError para catch específico em handler.ts
      const zodMessage = err instanceof Error ? err.message : String(err);
      throw new BrainOutputValidationError(
        `BrainOutput schema validation failed: ${zodMessage}`,
        { brainId: this.brain.id, threadId, rawOutput }
      );
    }

    // Step 4: Persist long-term memory after the turn (MEM-04)
    // Pitfall 5: usar brainOutput.fullResponse em vez de 'reply' (variável removida)
    await this.memoryManager.saveContext({
      userId: event.IDLead,
      profileKey: "context",
      profileValue: {
        lastUserMessage: event.Message,
        lastReply: brainOutput.fullResponse,
        conversationId: threadId,
      },
    });

    // D-02, D-08: extrair tokenUsage do estado retornado pelo grafo
    // D-05: fallback para zeros quando provider não reporta usage_metadata
    const tokenUsage: TokenUsage = result.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    return { brainOutput, tokenUsage };
  }

  /**
   * MCP-05, D-04: Fecha o MultiServerMCPClient de forma limpa.
   * No-op quando mcpClient é null (sem MCP configurado).
   * Chamado pelo handler SIGTERM registrado em init().
   */
  async close(): Promise<void> {
    // WR-03: Remover SIGTERM handler — evita acúmulo de listeners em reinicializações
    if (this._sigtermHandler) {
      process.off('SIGTERM', this._sigtermHandler);
      this._sigtermHandler = null;
    }
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
    }
    // EVT-01: Fechar EventPublisher (fecha conexão RabbitMQ se aberta)
    if (this.eventPublisher) {
      await this.eventPublisher.close();
      this.eventPublisher = null;
    }
    // FUP-04/D-04: Parar FupScheduler no shutdown
    if (this.fupScheduler) {
      await this.fupScheduler.stop();
      this.fupScheduler = null;
    }
  }

  /** Internal: compile the graph with checkpointer and inject context */
  private async _compileGraph(): Promise<void> {
    // D-06: Fail-fast if DATABASE_URL missing — avoids cryptic downstream connection errors
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      this.logger.error({ brainId: this.brain.id }, "DATABASE_URL is not set — cannot create checkpointer");
      process.exit(1);
    }
    const checkpointer = await createCheckpointer(
      // TenantPoolManager provides the connection string; for v1 single-tenant,
      // BrainRunner receives the Sql directly and uses it for all queries.
      // PostgresSaver needs a connection string — derive from env.
      dbUrl
    );
    // D-12/Pitfall 6: salvar instância para injetar no FupScheduler em init()
    this.checkpointer = checkpointer;

    // Drizzle db for MemoryManager — uses same postgres.js Sql instance
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const db = drizzle(this.sql);

    this.memoryManager = new MemoryManager({ db, checkpointer });

    // Filter tools via ToolsRegistry (D-03, D-12)
    const filteredTools = this.toolsRegistry.getTools(
      this.brain.brainType,
      this.brain.tools
    );

    const llm = await createLLM(this.llmOptions);

    // --- BLOCO MCP (MCP-01, D-01) ---
    // D-14 CORREÇÃO: transport é "http" no JS (@langchain/mcp-adapters JS) — NÃO "streamable_http"
    // "streamable_http" é o valor do Python (langchain-mcp-adapters) e causa erro no schema Zod do JS.
    let mcpTools: import("@langchain/core/tools").StructuredTool[] = [];
    const mcpUrl = process.env.MCP_URL?.trim();

    if (mcpUrl) {
      // Fechar client antigo antes de reconectar — evita vazamento de conexão no TTL reconnect
      if (this.mcpClient) {
        await this.mcpClient.close().catch(() => {});
        this.mcpClient = null;
      }
      try {
        this.mcpClient = new MultiServerMCPClient({
          mcpServers: {
            "external-server": {
              // transport omitido — presença de `url` identifica HTTP. Alternativa: transport: "http"
              url: mcpUrl,
              // D-10: Bearer token via MCP_AUTH_TOKEN — ausente = sem auth
              ...(process.env.MCP_AUTH_TOKEN && {
                headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` },
              }),
            },
          },
          // PITFALL-1: default é "throw" — usar "ignore" para não travar startup se servidor inacessível
          onConnectionError: "ignore",
        });

        let allTools = await this.mcpClient.getTools();

        // D-08: MCP_TOOLS CSV filtra por nome exato; D-07: ausente/vazio = todas
        const toolFilter = process.env.MCP_TOOLS?.trim();
        if (toolFilter) {
          const allowed = new Set(
            toolFilter.split(",").map((t) => t.trim()).filter(Boolean)
          );
          allTools = allTools.filter((t) => allowed.has(t.name));
        }

        mcpTools = allTools;
        this.mcpInitTime = Date.now();
        this.logger.info(
          { brainId: this.brain.id, mcpToolCount: mcpTools.length, mcpToolNames: mcpTools.map(t => t.name) },
          "MCP tools loaded successfully"
        );
      } catch (err) {
        // D-12: defensive catch — servidor inacessível não impede startup
        // SECURITY: nunca logar process.env.MCP_AUTH_TOKEN no err (T-15-01)
        this.logger.warn(
          { brainId: this.brain.id, err },
          "MCP server unreachable at startup — continuing with native tools only (MCP-03)"
        );
        this.mcpClient = null;
        mcpTools = [];
      }
    }
    // --- FIM BLOCO MCP ---

    const ctx: BrainBuildContext = {
      llm,
      prompts: this.prompts,
      tools: filteredTools,
      sql: this.sql, // D-03: injetado para tools de DB — buildGraph() acessa via ctx.sql
      mcpTools, // D-01: sempre array; [] quando MCP_URL ausente (D-09)
      // D-02/TECH-01: enabledTools exposto para Brain filtrar closures nativas em buildGraph()
      enabledTools: this.toolsRegistry.getEnvWhitelist(),
    };

    // D-02: compile() called HERE — never inside buildGraph()
    this.compiledGraph = this.brain.buildGraph(ctx).compile({ checkpointer });
  }
}
