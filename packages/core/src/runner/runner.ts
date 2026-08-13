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
import { runMigrations, runBrainSeed } from "@brain-pkg/database";
import { MemoryManager } from "@brain-pkg/memory";
import type { IEmbeddingProvider } from "@brain-pkg/embeddings";
import { createEmbeddingProvider } from "@brain-pkg/embeddings";
import { createTracingCallbacks } from "@brain-pkg/observability";
import { createLogger } from "@brain-pkg/observability";
import { ConfigurationError, BrainOutputValidationError } from "@brain-pkg/shared";
import type { BrainOutput, TokenUsage } from "@brain-pkg/shared";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
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
import { EventPublisher, isErrorToolResult } from "../events/event-publisher.js";
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
  /** Pasta de seeds por brain_type para runBrainSeed() no init(). Se omitido, usa SEEDS_FOLDER ENV. */
  seedsFolder?: string;
  /** EventPublisher injetável para testes (D-11). Ausente = criado em init() a partir de ENVs. */
  eventPublisher?: IEventPublisher;
  /** IEmbeddingProvider injetável para testes (EMBD-05). Ausente = criado em init() a partir de ENVs — mesmo padrão de eventPublisher. */
  embeddingProvider?: IEmbeddingProvider;
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
  private readonly seedsFolder: string | undefined;
  private readonly logger = createLogger();

  private prompts: Record<string, string> = {};
  // AI-01: compiledGraph uses PostgresSaver (createCheckpointer) in production.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private compiledGraph: any | null = null;
  private memoryManager: MemoryManager | null = null;
  private mcpClient: MultiServerMCPClient | null = null;
  private eventPublisher: IEventPublisher | null = null;
  private embeddingProvider: IEmbeddingProvider | null = null;
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
    this.seedsFolder = options.seedsFolder;
    this.leadService = new LeadService(options.sql);
    // D-11: EventPublisher injetável para testes; null = criado em init() a partir de ENVs
    if (options.eventPublisher) {
      this.eventPublisher = options.eventPublisher;
    }
    // EMBD-05: embeddingProvider injetável para testes; null = criado em init() a partir de ENVs
    if (options.embeddingProvider) {
      this.embeddingProvider = options.embeddingProvider;
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

    // SEED-02/SEED-03: runBrainSeed() roda entre runMigrations() e loadPrompts() — garante
    // que fup_config e prompts(key='fup') existem para este brainType antes do fail-fast
    // loop de promptKeys abaixo. D-08/D-09: falha de seed é fail-fast, mesmo padrão de
    // MIGRATIONS_FOLDER acima.
    const seedsFolder = this.seedsFolder ?? process.env.SEEDS_FOLDER;
    if (!seedsFolder) {
      this.logger.error(
        { brainId: this.brain.id },
        'SEEDS_FOLDER not set — cannot run brain seed'
      );
      process.exit(1);
    }
    await runBrainSeed(this.sql, this.brain.brainType, seedsFolder).catch((err: unknown) => {
      this.logger.error({ brainId: this.brain.id, err }, 'Brain seed failed — aborting init');
      process.exit(1);
    });
    this.logger.info({ brainId: this.brain.id }, 'Brain seed completed');

    // EMBD-05: resolver embeddingProvider — SEMPRE, não condicional a ENV presente
    // (D-09: embedding é bloqueante no fluxo principal, não opcional como eventPublisher)
    if (!this.embeddingProvider) {
      this.embeddingProvider = await createEmbeddingProvider();
    }

    // D-15: fail-fast se a dimensão do provider não bate com a coluna vector(N) já migrada.
    // Roda APÓS runMigrations() (coluna já existe) e APÓS embeddingProvider resolvido.
    // atttypmod cross-version note: for pgvector's `vector(N)` column type, atttypmod stores N
    // (the configured dimension count) directly — unlike PostgreSQL's built-in varchar(N)/numeric(N),
    // which store typmod with an internal offset (e.g. varchar's atttypmod = N + 4). This direct
    // 1:1 mapping is defined by pgvector's own type modifier implementation (vector_typmod_in/out in
    // the extension source) and has been stable across pgvector 0.5.x-0.8.x — no offset math needed
    // here. If a future pgvector major version changes this, this query would need adjustment.
    const dimensionRows = await this.sql<{ dimensions: number }[]>`
      SELECT atttypmod AS dimensions
      FROM pg_attribute
      WHERE attrelid = 'knowledge_chunks'::regclass
        AND attname = 'embedding'
        AND attnum > 0
    `;
    if (dimensionRows.length === 0) {
      this.logger.error(
        { brainId: this.brain.id },
        "knowledge_chunks.embedding column not found in pg_attribute — migrations may not have run yet"
      );
      process.exit(1);
    }
    const columnDim = dimensionRows[0].dimensions;
    if (columnDim !== this.embeddingProvider.dimensions) {
      this.logger.error(
        {
          brainId: this.brain.id,
          expected: columnDim,
          actual: this.embeddingProvider.dimensions,
          providerName: this.embeddingProvider.providerName,
        },
        "EMBEDDING_DIMENSIONS mismatch — provider dimensions do not match the vector(N) column. Fix EMBEDDING_DIMENSIONS or regenerate migration 0009."
      );
      process.exit(1);
    }

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
    // D-01/WR-02: remove any previously-registered handler from an earlier init() call
    // before registering a new one — prevents listener accumulation on repeated init().
    if (this._sigtermHandler) {
      process.off('SIGTERM', this._sigtermHandler);
    }
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
   * D-1: Inject a synthetic AIMessage directly into a thread's LangGraph checkpoint,
   * without invoking the graph or generating a real LLM response.
   *
   * Works even for a thread_id without a prior checkpoint — updateState() falls back to
   * the `messages` channel default `[]` defined in BrainStateAnnotation.
   *
   * Called by POST /debug/inject-message handler.
   */
  async injectMessage(threadId: string, content: string): Promise<void> {
    if (!this.compiledGraph) {
      throw new ConfigurationError(
        "BrainRunner.init() must be called before injectMessage()",
        { brainId: this.brain.id }
      );
    }

    await this.compiledGraph.updateState(
      { configurable: { thread_id: threadId } },
      { messages: [new AIMessage(content)] }
    );

    // SECURITY: never log `content` — may hold arbitrary admin-supplied text
    this.logger.info(
      { brainId: this.brain.id, threadId },
      "Debug message injected into thread checkpoint"
    );
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

    // FUP-06 / D-19: Re-armar o ciclo de FUP quando o lead responde.
    // Zera fup_step=0 e recalcula fup_next_at a partir de fup_config (step 0), de modo
    // que o lead volte a ser elegível caso silencie de novo. fup_enabled permanece intocado.
    await this.leadService.resetFup(lead.uniqueId, this.brain.brainType);

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

    // EMBD-05/D-09: Embed a mensagem do usuário ANTES de getContext() — bloqueante,
    // getContext() depende do vetor para busca semântica. D-10: fallback gracioso —
    // falha na chamada de embedding nunca quebra o atendimento ao lead.
    let queryVector: number[] = [];
    try {
      queryVector = await this.embeddingProvider!.embedQuery(event.Message);
    } catch (err) {
      this.logger.warn(
        { brainId: this.brain.id, threadId, err },
        "embeddingProvider.embedQuery failed — continuing with empty queryVector (D-10 fallback)"
      );
    }

    // Step 1: Hydrate memory — retrieve context from all 3 layers (MEM-04)
    await this.memoryManager.getContext(threadId, event.IDLead, queryVector);

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
          const resultContent =
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);

          // EVT-06: resultado marcado como falha não vira evento — publicá-lo faria o
          // consumidor externo tratar um erro técnico como decisão de negócio
          // T-20-02: logar apenas toolName/threadId — nunca a payload (PII do lead)
          if (isErrorToolResult(resultContent)) {
            this.logger.warn(
              { toolName: msg.name, threadId },
              "Tool result marcado como erro — evento não publicado (EVT-06)"
            );
            continue;
          }

          toolEvents.push({
            event_id: `${threadId}:${msg.tool_call_id}`,
            action: msg.name,
            lead: {
              id: lead.uniqueId,
              nome: lead.nome ?? null,
              numero: lead.numero,
            },
            result: resultContent,
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
    // EMBD-05/D-08: embedar profileValue e popular embedding — ativa upsertEmbedding()
    // (MEM-03 original — nunca disparado até esta fase). D-10: fallback gracioso.
    // Pitfall 5: usar brainOutput.fullResponse em vez de 'reply' (variável removida)
    const profileValue = {
      lastUserMessage: event.Message,
      lastReply: brainOutput.fullResponse,
      conversationId: threadId,
    };
    let embeddingField: { userId: string; sessionId: string; content: string; embedding: number[] } | undefined;
    try {
      const profileText = `${profileValue.lastUserMessage}\n${profileValue.lastReply}`;
      const [vector] = await this.embeddingProvider!.embed([profileText]);
      embeddingField = {
        userId: event.IDLead,
        sessionId: threadId,
        content: profileText,
        embedding: vector,
      };
    } catch (err) {
      this.logger.warn(
        { brainId: this.brain.id, threadId, err },
        "embeddingProvider.embed failed for saveContext — continuing without embedding (D-10 fallback)"
      );
    }

    await this.memoryManager.saveContext({
      userId: event.IDLead,
      profileKey: "context",
      profileValue,
      embedding: embeddingField,
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
    // IN-04 (28-REVIEW)/TECH-06: DATABASE_URL presence is already validated at startup by each
    // Brain app's index.ts (apps/brain-sdr, apps/brain-support) BEFORE runner.init() is called —
    // re-checking here was redundant (same process, same ENV snapshot). createCheckpointer()
    // will still fail loudly if DATABASE_URL is somehow empty/malformed at call time.
    const dbUrl = process.env.DATABASE_URL;
    const checkpointer = await createCheckpointer(
      // TenantPoolManager provides the connection string; for v1 single-tenant,
      // BrainRunner receives the Sql directly and uses it for all queries.
      // PostgresSaver needs a connection string — derive from env.
      dbUrl!
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
