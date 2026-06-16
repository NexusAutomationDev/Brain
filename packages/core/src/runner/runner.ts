// SDK-02: BrainRunner — host that orchestrates a complete conversation turn.
// D-12: run() returns { brainOutput, tokenUsage } | null — wrapper with structured output + token consumption.
// D-06: Lifecycle: new BrainRunner({...}) sync → await runner.init() async → runner.run(event) per request.
// D-06: init() fails with process.exit(1) if any promptKey is missing — fail-fast startup pattern.
// D-07: refreshPrompts() reloads prompts AND recompiles graph (prompts are snapshot in buildGraph closure).
// AI-01: PostgresSaver ONLY in production — see packages/ai/src/graph/checkpointer.ts.
// Anti-pattern: NEVER call .compile() inside buildGraph() — BrainRunner owns compilation.

import { createCheckpointer, createLLM } from "@brain-pkg/ai";
import type { LLMOptions } from "@brain-pkg/ai";
import { runMigrations } from "@brain-pkg/database";
import { MemoryManager } from "@brain-pkg/memory";
import { createTracingCallbacks } from "@brain-pkg/observability";
import { createLogger } from "@brain-pkg/observability";
import { ConfigurationError, BrainOutputValidationError } from "@brain-pkg/shared";
import type { BrainOutput, TokenUsage } from "@brain-pkg/shared";
import type { BaseMessage } from "@langchain/core/messages";
import type { BrainEvent } from "@brain-pkg/transport";
import type { Sql } from "postgres";
import type { IBrain, BrainBuildContext } from "../brain/interface.js";
import { ToolsRegistry } from "../tools/registry.js";
import { loadPrompts, upsertPrompts } from "../prompts/loader.js";
import { LeadService } from "../leads/lead-service.js";
import type { Lead } from "../leads/lead-service.js";
import { BrainOutputSchema } from "../output/schema.js";

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
  private leadService!: LeadService; // inicializado no construtor

  constructor(options: BrainRunnerOptions) {
    this.brain = options.brain;
    this.sql = options.sql;
    this.toolsRegistry = options.toolsRegistry;
    this.llmOptions = options.llmOptions;
    this.migrationsFolder = options.migrationsFolder;
    this.leadService = new LeadService(options.sql);
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

    // D-06: Fluxo — upsert lead → gate ia_ativada → LLM (LEAD-02, LEAD-03)
    const lead: Lead = await this.leadService.upsertLead(
      event.Numero,
      event.IDLead,
      event.Name
    );

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
      },
      {
        configurable: { thread_id: threadId },
        callbacks,
      }
    );

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

    const ctx: BrainBuildContext = {
      llm,
      prompts: this.prompts,
      tools: filteredTools,
      sql: this.sql, // D-03: injetado para tools de DB — buildGraph() acessa via ctx.sql
    };

    // D-02: compile() called HERE — never inside buildGraph()
    this.compiledGraph = this.brain.buildGraph(ctx).compile({ checkpointer });
  }
}
