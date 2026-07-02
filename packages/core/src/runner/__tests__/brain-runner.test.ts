// SDK-02: BrainRunner — lifecycle init() + run() returning BrainOutput | null
// Uses MemorySaver in tests (AI-01 allows MemorySaver ONLY in *.test.ts)
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
// NOTE: BrainEvent type defined inline to avoid loading @brain-pkg/transport at test startup.
// Loading transport causes zod to initialize partially (via events.ts BrainEventSchema) before
// schema.ts in core is loaded, triggering zod v4 "cached value already set" panic in bun 1.3.2.
type BrainEvent = { Name: string; Message: string; Numero: string; IDLead: string };

// --- Mocks setup (before imports that use them) ---

const mockLoadPrompts = mock(async () => ({
  "system": "You are a test assistant",
}));
const mockUpsertPrompts = mock(async () => {});

mock.module("../../prompts/loader.js", () => ({
  loadPrompts: mockLoadPrompts,
  upsertPrompts: mockUpsertPrompts,
}));

// NOTE: @langchain/langgraph and @langchain/core/messages are NOT imported directly here.
// Loading those modules causes a zod v4 "cached value already set" panic in bun 1.3.2 when
// schema.ts (which uses z.object()) is loaded afterward in the same process.
// Solution: mock both modules to avoid loading the real zod-dependent code.
// AI-01: MemorySaver is allowed in *.test.ts — we use a lightweight mock class instead of
// the real LangGraph MemorySaver since the compiledGraph itself is fully mocked in these tests.
class MockMemorySaver {
  storage: Record<string, unknown> = {};
}
class MockAIMessage {
  constructor(public content: string) {}
}
class MockHumanMessage {
  constructor(public content: string) {}
}
class MockToolMessage {
  constructor(public props: Record<string, unknown>) {
    Object.assign(this, props);
  }
  static isInstance(msg: unknown): msg is MockToolMessage {
    return msg instanceof MockToolMessage;
  }
}

mock.module("@langchain/langgraph", () => ({
  MemorySaver: MockMemorySaver,
  StateGraph: class {},
  START: "__start__",
  END: "__end__",
}));

mock.module("@langchain/core/messages", () => ({
  AIMessage: MockAIMessage,
  HumanMessage: MockHumanMessage,
  BaseMessage: MockAIMessage,
  ToolMessage: MockToolMessage,
}));

const mockMemorySaver = new MockMemorySaver();
mock.module("@brain-pkg/ai", () => ({
  createCheckpointer: mock(async () => mockMemorySaver),
  createLLM: mock(async () => ({ invoke: mock(async () => new MockAIMessage("test reply")) })),
  BrainStateAnnotation: {},
}));

// EMBD-05: track the most recently constructed MemoryManager mock instance so tests
// can assert on getContext()/saveContext() call args (queryVector, embedding field).
let lastMemoryManagerInstance: {
  getContext: ReturnType<typeof mock>;
  saveContext: ReturnType<typeof mock>;
} | null = null;

mock.module("@brain-pkg/memory", () => ({
  MemoryManager: mock(function () {
    lastMemoryManagerInstance = {
      getContext: mock(async () => ({ profile: null, checkpoint: undefined, similarEmbeddings: [] })),
      saveContext: mock(async () => {}),
    };
    return lastMemoryManagerInstance;
  }),
}));

mock.module("@brain-pkg/observability", () => ({
  createTracingCallbacks: mock(() => []),
  createLogger: mock(() => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  })),
}));

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => ({})),
}));

// EMBD-05/D-13: mock the underlying LangChain SDK package instead of @brain-pkg/embeddings
// directly — mock.module() patches the global module registry by resolved path, so mocking
// @brain-pkg/embeddings here would leak into packages/embeddings/src/__tests__/unit/factory.test.ts
// when both files run in the same bun test process (factory.test.ts's own dynamic imports of
// openai-provider.js/gemini-provider.js would resolve through this leaked mock instead of the
// real factory implementation). Mocking @langchain/openai instead is safe: it is also mocked
// (identically) in factory.test.ts and openai-provider.test.ts, so there is no behavior mismatch,
// and it lets the REAL createEmbeddingProvider()/OpenAIEmbeddingProvider run in these tests —
// resolving to providerName: "openai", dimensions: 1536 (EMBEDDING_PROVIDER/EMBEDDING_DIMENSIONS
// are not set in this test file, so factory.ts's default resolution applies).
mock.module("@langchain/openai", () => ({
  OpenAIEmbeddings: class MockOpenAIEmbeddings {
    async embedQuery(_text: string): Promise<number[]> {
      return [0.1, 0.2, 0.3];
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
      return texts.map(() => [0.1, 0.2, 0.3]);
    }
  },
}));

// Plain local object used ONLY for explicit embeddingProvider injection via BrainRunnerOptions
// (bypasses createEmbeddingProvider()/factory.ts entirely) — not wired through mock.module.
const mockEmbeddingProvider = {
  embed: mock(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  embedQuery: mock(async (_text: string) => [0.1, 0.2, 0.3]),
  dimensions: 1536,
  providerName: "openai",
};

// EMBD-05/D-15: tagged-template-compatible mock for `this.sql<...>`...`` calls in runner.ts.
// Default resolves the dimension-check query to 1536 — matches mockEmbeddingProvider.dimensions
// so the fail-fast check passes by default in all existing tests.
function makeMockSql(dimensions = 1536) {
  const fn = mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [
    { dimensions },
  ]);
  return fn as unknown as import("postgres").Sql;
}
const mockSql = makeMockSql();

mock.module("@brain-pkg/database", () => ({
  runMigrations: mock(async () => {}),
  // Mock das tabelas do Drizzle — necessário porque lead-service.ts importa `leads` de @brain-pkg/database
  // O mock de lead-service.js intercepta o LeadService mas o bun analisa os named exports do módulo
  leads: {},
  prompts: {},
  users: {},
  memories: {},
  agentState: {},
  embeddings: {},
  eq: mock(() => {}),
  and: mock(() => {}),
  or: mock(() => {}),
  sql: mock(() => {}),
  drizzle: mock(() => ({})),
  TenantPoolManager: mock(function () { return {}; }),
}));

// Satisfy MIGRATIONS_FOLDER check in runner.init() — prevents process.exit(1) before runMigrations
process.env.MIGRATIONS_FOLDER = "/tmp/test-migrations";
// Satisfy DATABASE_URL check in _compileGraph() — prevents process.exit(1) when createCheckpointer is called
// The value is fake but the mock of @brain-pkg/ai.createCheckpointer intercepts before any real connection.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb";

// Mock LeadService — LEAD-03: gate ia_ativada controlled per test
const mockUpsertLead = mock(async () => ({
  id: "uuid-1",
  uniqueId: "lead-abc",
  numero: "5511999990001",
  nome: "Test User",
  iaAtivada: true, // default: IA ativa — testes existentes não são afetados
  fullpp: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

mock.module("../../leads/lead-service.js", () => ({
  LeadService: mock(function () {
    return {
      upsertLead: mockUpsertLead,
      getByNumero: mock(async () => null),
      // FUP-06: touchLastMessage adicionado ao runner.ts — mock necessário para evitar TypeError
      touchLastMessage: mock(async () => {}),
      // FUP-06: resetFup adicionado ao runner.ts — mock necessário para evitar TypeError
      resetFup: mock(async () => {}),
    };
  }),
}));

// Import after mocks
import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";
// D-13: real @brain-pkg/embeddings module import (no longer mocked) — used by Test 3 to spy on
// createEmbeddingProvider() call timing relative to the dimension-check sql query.
import * as embeddingsModule from "@brain-pkg/embeddings";
import type { IBrain } from "../../brain/interface.js";
import type { IEventPublisher } from "../../events/event-publisher.js";
// NOTE: ToolMessage in tests uses MockToolMessage (via mock.module("@langchain/core/messages"))
// Use MockToolMessage directly in test instances — ToolMessage.isInstance() in runner.ts will
// recognize them because the mock replaces ToolMessage with MockToolMessage.
// Alias for clarity in test code:
const ToolMessage = MockToolMessage;

function makeBrain(promptKeys = ["system"]): IBrain {
  return {
    id: "test-brain",
    brainType: "test",
    promptKeys,
    tools: [],
    buildGraph: mock(() => ({
      compile: mock(() => ({
        invoke: mock(async () => ({
          messages: [
            new MockHumanMessage("hello"),
            new MockAIMessage("test reply"),
          ],
          // SDK-06: D-08 — nó do grafo seta brainOutput manualmente
          brainOutput: {
            fullResponse: "test reply",
            responseMode: "text",
          },
          // TOK-03: tokenUsage acumulado pelo BrainStateAnnotation reducer
          tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        })),
        getState: mock(async () => ({ values: { messages: [] } })),  // HIST-03
      })),
    })) as unknown as IBrain["buildGraph"],
  };
}

function makeEvent(): BrainEvent {
  return {
    Name: "Test User",
    Message: "hello",
    Numero: "5511999990001",
    IDLead: "lead-test-1",
  };
}

describe("BrainRunner", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy"); // register brainType to avoid ConfigurationError
  });

  test("init() loads prompts from DB and compiles the graph", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    await runner.init();

    expect(mockLoadPrompts).toHaveBeenCalledWith(mockSql, "test", ["system"]);
  });

  test("D-01: calling init() twice on the same instance does not increase SIGTERM listener count", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    await runner.init();
    const countAfterFirstInit = process.listenerCount("SIGTERM");

    await runner.init();
    const countAfterSecondInit = process.listenerCount("SIGTERM");

    expect(countAfterSecondInit).toBe(countAfterFirstInit);

    // Cleanup: remove the listener registered by this test's runner so it doesn't leak
    // into other tests' process.listenerCount("SIGTERM") assertions.
    await runner.close();
  });

  test("init() calls process.exit(1) when MIGRATIONS_FOLDER ENV is not set and migrationsFolder option is absent (D-11, T-06-07)", async () => {
    const savedFolder = process.env.MIGRATIONS_FOLDER;
    delete process.env.MIGRATIONS_FOLDER;

    const originalExit = process.exit;
    const mockExit = mock((_code: number) => { throw new Error("process.exit called"); });
    process.exit = mockExit as never;

    const brain = makeBrain(["system"]);
    // No migrationsFolder option passed — relies solely on ENV (which is now unset)
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    try {
      await runner.init();
      expect.unreachable("init() should have called process.exit(1)");
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
      // Restore ENV so subsequent tests are not affected
      process.env.MIGRATIONS_FOLDER = savedFolder;
    }
  });

  test("init() calls process.exit(1) when a promptKey is missing from DB", async () => {
    mockLoadPrompts.mockImplementationOnce(async () => ({})); // returns no keys

    const originalExit = process.exit;
    const mockExit = mock((_code: number) => { throw new Error("process.exit called"); });
    process.exit = mockExit as never;

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    try {
      await runner.init();
      expect.unreachable("should have called process.exit");
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("run(event) retorna wrapper com brainOutput.fullResponse e brainOutput.responseMode", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(result?.brainOutput.fullResponse).toBe("test reply");
    expect(result?.brainOutput.responseMode).toBe("text");
  });

  test("run() retorna wrapper com brainOutput — sem vazamento de estado interno", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result?.brainOutput).toHaveProperty("fullResponse");
    expect(result?.brainOutput).toHaveProperty("responseMode");
    expect(result).not.toHaveProperty("messages");  // T-05-03: estado interno não vaza
    expect(result).not.toHaveProperty("sessionId");
  });

  // --- Testes TOK-04: wrapper { brainOutput, tokenUsage } ---

  test("run() returns wrapper { brainOutput, tokenUsage } (D-02, D-08, TOK-04a)", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(result?.brainOutput).toBeDefined();
    expect(result?.brainOutput.fullResponse).toBe("test reply");
    expect(result?.brainOutput.responseMode).toBe("text");
    expect(result?.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test("run() returns null when ia_ativada=false (behavior preserved, TOK-04b)", async () => {
    mockUpsertLead.mockImplementationOnce(async () => ({
      id: "uuid-1",
      uniqueId: "lead-abc",
      numero: "5511999990001",
      nome: "Test User",
      iaAtivada: false,
      fullpp: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
    await runner.init();
    const result = await runner.run(makeEvent());
    expect(result).toBeNull();
  });

  test("run() tokenUsage usa valores do state.tokenUsage retornado pelo grafo (TOK-04c)", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
    await runner.init();
    const result = await runner.run(makeEvent());

    // Valores vêm do mock de invoke() que retorna tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    expect(result?.tokenUsage.inputTokens).toBe(10);
    expect(result?.tokenUsage.outputTokens).toBe(5);
    expect(result?.tokenUsage.totalTokens).toBe(15);
  });

  test("run() tokenUsage retorna zeros quando invoke() não inclui tokenUsage (TOK-04d — fallback seguro)", async () => {
    const brainSemTokenUsage: IBrain = {
      ...makeBrain(),
      buildGraph: mock(() => ({
        compile: mock(() => ({
          invoke: mock(async () => ({
            messages: [new MockHumanMessage("hello"), new MockAIMessage("test reply")],
            brainOutput: { fullResponse: "test reply", responseMode: "text" },
            // tokenUsage ausente — simula provider antigo sem suporte a usage_metadata
          })),
          getState: mock(async () => ({ values: { messages: [] } })),
        })),
      })) as unknown as IBrain["buildGraph"],
    };
    const runner = new BrainRunner({ brain: brainSemTokenUsage, sql: mockSql, toolsRegistry: registry });
    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(result?.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("refreshPrompts() reloads prompts from DB and recompiles the graph", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    await runner.init();
    const callCountBefore = mockLoadPrompts.mock.calls.length;

    await runner.refreshPrompts();

    expect(mockLoadPrompts.mock.calls.length).toBeGreaterThan(callCountBefore);
    // Verify graph was recompiled by checking buildGraph was called again
    expect((brain.buildGraph as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(1);
  });

  test("refreshPrompts() calls upsertPrompts when brain.defaultPrompts is defined", async () => {
    mockUpsertPrompts.mockClear();
    const brain: IBrain = {
      ...makeBrain(["system"]),
      defaultPrompts: { system: "Updated system prompt" },
    };
    const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
    await runner.init();

    await runner.refreshPrompts();

    expect(mockUpsertPrompts).toHaveBeenCalledTimes(1);
    const [, brainType, prompts] = mockUpsertPrompts.mock.calls[0] as [unknown, string, Record<string, string>];
    expect(brainType).toBe("test");
    expect(prompts).toEqual({ system: "Updated system prompt" });
  });

  test("refreshPrompts() does NOT call upsertPrompts when brain.defaultPrompts is undefined", async () => {
    mockUpsertPrompts.mockClear();
    const brain = makeBrain(["system"]); // no defaultPrompts
    const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
    await runner.init();

    await runner.refreshPrompts();

    expect(mockUpsertPrompts).not.toHaveBeenCalled();
  });

  // --- Testes LEAD-03: gate ia_ativada ---

  describe("gate ia_ativada (LEAD-03)", () => {
    beforeEach(() => {
      mockUpsertLead.mockClear();
    });

    test("run() retorna null quando lead.iaAtivada=false", async () => {
      mockUpsertLead.mockImplementationOnce(async () => ({
        id: "uuid-1",
        uniqueId: "lead-abc",
        numero: "5511999990001",
        nome: "Test User",
        iaAtivada: false, // gate deve bloquear
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();

      const result = await runner.run(makeEvent());
      expect(result).toBeNull();
    });

    test("run() retorna wrapper quando iaAtivada=true", async () => {
      // mockUpsertLead default já retorna iaAtivada: true — sem override necessário
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();

      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.brainOutput.fullResponse).toBe("test reply");
    });

    test("run() chama upsertLead com Numero, IDLead e Name do evento", async () => {
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();

      await runner.run(makeEvent());

      expect(mockUpsertLead).toHaveBeenCalledTimes(1);
      const [numero, idLead, name] = mockUpsertLead.mock.calls[0] as [string, string, string];
      expect(numero).toBe("5511999990001");
      expect(idLead).toBe("lead-test-1");
      expect(name).toBe("Test User");
    });
  });

  // --- Testes D-14: lançar BrainOutputValidationError ---

  describe("D-14: BrainOutputValidationError quando brainOutput inválido", () => {
    test("run() lança BrainOutputValidationError quando brainOutput é null após invoke", async () => {
      const brainSemOutput: IBrain = {
        ...makeBrain(),
        buildGraph: mock(() => ({
          compile: mock(() => ({
            invoke: mock(async () => ({
              messages: [new MockHumanMessage("hello"), new MockAIMessage("reply")],
              brainOutput: null,  // nó não setou brainOutput
            })),
            getState: mock(async () => ({ values: { messages: [] } })),
          })),
        })) as unknown as IBrain["buildGraph"],
      };
      const runner = new BrainRunner({ brain: brainSemOutput, sql: mockSql, toolsRegistry: registry });
      await runner.init();

      // NOTE: using string check instead of class import to avoid zod v4 "cached value already set" panic in bun 1.3.2
      await expect(runner.run(makeEvent())).rejects.toThrow("BrainOutput");
    });

    test("run() lança BrainOutputValidationError quando brainOutput tem schema inválido (fullResponse vazia)", async () => {
      const brainOutputInvalido: IBrain = {
        ...makeBrain(),
        buildGraph: mock(() => ({
          compile: mock(() => ({
            invoke: mock(async () => ({
              messages: [new MockHumanMessage("hello"), new MockAIMessage("reply")],
              brainOutput: { fullResponse: "", responseMode: "text" },  // fullResponse vazia falha no Zod
            })),
            getState: mock(async () => ({ values: { messages: [] } })),
          })),
        })) as unknown as IBrain["buildGraph"],
      };
      const runner = new BrainRunner({ brain: brainOutputInvalido, sql: mockSql, toolsRegistry: registry });
      await runner.init();

      // NOTE: using string check instead of class import to avoid zod v4 "cached value already set" panic in bun 1.3.2
      await expect(runner.run(makeEvent())).rejects.toThrow("BrainOutput");
    });
  });

  // --- Teste D-03: BrainBuildContext sql injection ---

  describe("D-03: _compileGraph passes sql to BrainBuildContext", () => {
    test("buildGraph receives ctx with sql equal to the sql instance passed to BrainRunner", async () => {
      // Callable (tagged-template) so `this.sql<...>`...`` in init()'s D-15 dimension
      // check resolves, while still carrying a `.tag` marker for identity comparison below.
      const sqlInstance = Object.assign(
        mock(async () => [{ dimensions: 1536 }]),
        { tag: "sql-sentinel" }
      ) as unknown as never;

      const buildGraphMock = mock(() => ({
        compile: mock(() => ({
          invoke: mock(async () => ({
            messages: [new MockHumanMessage("hello"), new MockAIMessage("test reply")],
            brainOutput: { fullResponse: "test reply", responseMode: "text" },
          })),
          getState: mock(async () => ({ values: { messages: [] } })),
        })),
      }));

      const brain: IBrain = {
        id: "test-brain",
        brainType: "test",
        promptKeys: ["system"],
        tools: [],
        buildGraph: buildGraphMock as unknown as IBrain["buildGraph"],
      };

      const runner = new BrainRunner({ brain, sql: sqlInstance, toolsRegistry: registry });
      await runner.init();

      // buildGraph must have been called exactly once during init()
      expect(buildGraphMock.mock.calls.length).toBe(1);

      // The first (and only) argument to buildGraph is BrainBuildContext
      const ctx = buildGraphMock.mock.calls[0][0] as { sql: unknown };

      // D-03: ctx.sql must be the exact same sql instance passed to BrainRunner
      expect(ctx.sql).toBe(sqlInstance);
    });
  });

  // --- Testes HIST-03: context window ---

  describe("HIST-03: context window (getState antes do invoke)", () => {
    const originalEnv = process.env.CONTEXT_WINDOW_MESSAGES;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CONTEXT_WINDOW_MESSAGES;
      } else {
        process.env.CONTEXT_WINDOW_MESSAGES = originalEnv;
      }
    });

    test("usa padrão 40 quando CONTEXT_WINDOW_MESSAGES não está definida", async () => {
      delete process.env.CONTEXT_WINDOW_MESSAGES;
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();
      // run() não deve lançar erro — getState retorna values.messages=[]
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.brainOutput.fullResponse).toBe("test reply");
    });

    test("usa CONTEXT_WINDOW_MESSAGES=10 quando definida", async () => {
      process.env.CONTEXT_WINDOW_MESSAGES = "10";
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.brainOutput.fullResponse).toBe("test reply");
    });

    test("fallback para 40 quando CONTEXT_WINDOW_MESSAGES é inválida ('abc')", async () => {
      process.env.CONTEXT_WINDOW_MESSAGES = "abc";
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();
      // Não deve lançar, não deve usar NaN como window size
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.brainOutput.fullResponse).toBe("test reply");
    });

    test("run() chama getState() com thread_id correto antes do invoke", async () => {
      const getStateMock = mock(async () => ({ values: { messages: [] } }));
      const brain: IBrain = {
        id: "test-brain",
        brainType: "test",
        promptKeys: ["system"],
        tools: [],
        buildGraph: mock(() => ({
          compile: mock(() => ({
            invoke: mock(async () => ({
              messages: [new MockHumanMessage("hello"), new MockAIMessage("test reply")],
              brainOutput: {
                fullResponse: "test reply",
                responseMode: "text",
              },
            })),
            getState: getStateMock,
          })),
        })) as unknown as IBrain["buildGraph"],
      };
      const runner = new BrainRunner({ brain, sql: mockSql, toolsRegistry: registry });
      await runner.init();
      await runner.run(makeEvent());

      expect(getStateMock).toHaveBeenCalledTimes(1);
      const [calledConfig] = getStateMock.mock.calls[0] as [any];
      // thread_id deve ser lead.uniqueId ("lead-abc" do mockUpsertLead)
      expect(calledConfig.configurable.thread_id).toBe("lead-abc");
    });
  });
});

describe("EVT-01: EventPublisher — sem ENV configurada", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy");
  });

  test("BrainRunner.init() e run() funcionam normalmente sem TOOL_EVENTS_URL nem TOOL_EVENTS_QUEUE", async () => {
    // Garantir que ENVs de eventos NÃO estão presentes
    const origUrl = process.env.TOOL_EVENTS_URL;
    const origQueue = process.env.TOOL_EVENTS_QUEUE;
    delete process.env.TOOL_EVENTS_URL;
    delete process.env.TOOL_EVENTS_QUEUE;

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });
    await runner.init();
    const result = await runner.run(makeEvent());
    // run() retorna resultado normal — sem erro
    expect(result).not.toBeNull();
    expect(result?.brainOutput.fullResponse).toBe("test reply");

    // Restore
    if (origUrl) process.env.TOOL_EVENTS_URL = origUrl;
    if (origQueue) process.env.TOOL_EVENTS_QUEUE = origQueue;
  });
});

describe("EVT-01: close() com publisher injetado", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy");
  });

  test("close() chama mockPublisher.close() exatamente 1 vez quando publisher é injetado", async () => {
    const mockClose = mock(async () => {});
    const mockPublisher: IEventPublisher = {
      publish: mock(async () => {}),
      close: mockClose,
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      eventPublisher: mockPublisher,
    });
    await runner.init();
    await runner.close();

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

describe("EVT-02, EVT-04: Whitelist e event_id — injeção via BrainRunnerOptions (D-11)", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy");
  });

  test("run() chama publish() com evento correto quando ToolMessage da whitelist está em result.messages", async () => {
    const mockPublish = mock(async (_events: unknown[]) => {});
    const mockPublisherClose = mock(async () => {});
    const mockEventPublisher: IEventPublisher = {
      publish: mockPublish as unknown as IEventPublisher["publish"],
      close: mockPublisherClose,
    };

    const brain = makeBrain(["system"]);
    brain.buildGraph = mock(() => ({
      compile: mock(() => ({
        invoke: mock(async () => ({
          messages: [
            new MockHumanMessage("hello"),
            // qualify_lead na whitelist — deve gerar evento
            new ToolMessage({ name: "qualify_lead", tool_call_id: "call-abc-123", content: "Lead qualificado" }),
            // respond fora da whitelist — não deve gerar evento
            new ToolMessage({ name: "respond", tool_call_id: "call-xyz-999", content: "Respondendo" }),
            new MockAIMessage("test reply"),
          ],
          brainOutput: { fullResponse: "test reply", responseMode: "text" },
          tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        })),
        getState: mock(async () => ({ values: { messages: [] } })),
      })),
    })) as unknown as IBrain["buildGraph"];

    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      eventPublisher: mockEventPublisher,
    });
    await runner.init();
    await runner.run(makeEvent());

    // EVT-02: somente qualify_lead (na whitelist) gera evento — respond é ignorado
    // EVT-04: event_id = threadId:tool_call_id
    // A Promise do publish corre em fire-and-forget — aguardar microtasks
    await Promise.resolve();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [publishedEvents] = mockPublish.mock.calls[0] as [unknown[]];
    expect(publishedEvents).toHaveLength(1);
    expect((publishedEvents[0] as Record<string, unknown>).action).toBe("qualify_lead");
    expect((publishedEvents[0] as Record<string, unknown>).event_id).toMatch(/:call-abc-123$/);
  });

  test("run() não chama publish() quando ToolMessage.name é undefined", async () => {
    const mockPublish = mock(async (_events: unknown[]) => {});
    const mockEventPublisher: IEventPublisher = {
      publish: mockPublish as unknown as IEventPublisher["publish"],
      close: mock(async () => {}),
    };

    const brain = makeBrain(["system"]);
    brain.buildGraph = mock(() => ({
      compile: mock(() => ({
        invoke: mock(async () => ({
          messages: [
            new MockHumanMessage("hello"),
            // ToolMessage sem name — não deve passar o guard typeof === "string"
            new ToolMessage({ tool_call_id: "call-no-name", content: "sem nome" }),
            new MockAIMessage("test reply"),
          ],
          brainOutput: { fullResponse: "test reply", responseMode: "text" },
          tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        })),
        getState: mock(async () => ({ values: { messages: [] } })),
      })),
    })) as unknown as IBrain["buildGraph"];

    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      eventPublisher: mockEventPublisher,
    });
    await runner.init();
    await runner.run(makeEvent());

    // name undefined não passa o guard typeof === "string" → publish não é chamado
    await Promise.resolve();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("EMBD-05: embeddingProvider injection + dimension fail-fast", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy");
  });

  test("Test 1: injected embeddingProvider is used — its embedQuery/embed are called, not the real factory's", async () => {
    const injectedProvider = {
      embed: mock(async (texts: string[]) => texts.map(() => [1, 2, 3])),
      embedQuery: mock(async (_text: string) => [1, 2, 3]),
      dimensions: 1536,
      providerName: "injected-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });

    await runner.init();
    await runner.run(makeEvent());

    // D-13: mockCreateEmbeddingProvider spy no longer exists — the module-level mock that used
    // to intercept @brain-pkg/embeddings's createEmbeddingProvider export was removed (it caused
    // cross-pollution with factory.test.ts). Assert injection took effect by checking the injected
    // provider's own mocks were invoked during run(), proving the real factory-created provider
    // was never reached.
    expect(injectedProvider.embedQuery).toHaveBeenCalled();
  });

  test("Test 2: no embeddingProvider injected — init() resolves the real factory-created provider (providerName: openai, dimensions: 1536)", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
    });

    // D-13: createEmbeddingProvider() is the REAL implementation from @brain-pkg/embeddings —
    // only @langchain/openai is mocked (module-level, above) — no EMBEDDING_PROVIDER/LLM_PROVIDER
    // ENV is set in this test file, so factory.ts's resolveEmbeddingProviderName() defaults to "openai".
    await expect(runner.init()).resolves.toBeUndefined();
  });

  test("Test 3: init() queries pg_attribute.atttypmod AFTER runMigrations() and AFTER provider resolution", async () => {
    const callOrder: string[] = [];

    const orderedSql = mock(async () => {
      callOrder.push("dimension-query");
      return [{ dimensions: 1536 }];
    }) as unknown as import("postgres").Sql;

    // D-13: no embeddingProvider injected — init() resolves the REAL createEmbeddingProvider()
    // from @brain-pkg/embeddings (only @langchain/openai is mocked, module-level, above).
    // spyOn wraps the real implementation without replacing it, so ordering is observed exactly
    // as it happens in runner.ts's init() — no manual/assumed marker needed.
    const createEmbeddingProviderSpy = spyOn(embeddingsModule, "createEmbeddingProvider");
    createEmbeddingProviderSpy.mockImplementation(async () => {
      callOrder.push("createEmbeddingProvider");
      return mockEmbeddingProvider;
    });

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: orderedSql,
      toolsRegistry: registry,
    });

    await runner.init();

    // runMigrations() itself is mocked (no callOrder entry) — but createEmbeddingProvider
    // and the dimension query both happen after it in the source; assert relative ordering
    // between provider resolution and the dimension query.
    expect(callOrder).toEqual(["createEmbeddingProvider", "dimension-query"]);

    createEmbeddingProviderSpy.mockRestore();
  });

  test("D-07: init() throws a clear error (not a raw destructure crash) when the atttypmod query returns zero rows", async () => {
    // One-off mock sql that resolves to an empty array (zero rows) ONLY for this test —
    // does not change the shared mockSql/makeMockSql default used by other tests.
    const emptyRowsSql = mock(async () => []) as unknown as import("postgres").Sql;

    const originalExit = process.exit;
    const mockExit = mock((_code: number) => { throw new Error("process.exit called"); });
    process.exit = mockExit as never;

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: emptyRowsSql,
      toolsRegistry: registry,
    });

    try {
      await runner.init();
      expect.unreachable("init() should have called process.exit(1) on zero-row atttypmod query");
    } catch (e) {
      // Must be the clear process.exit(1) path, NOT a raw "Cannot destructure property" TypeError
      expect((e as Error).message).toBe("process.exit called");
      expect((e as Error).message).not.toContain("Cannot destructure");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("Test 4: dimension mismatch — logger.error with 'EMBEDDING_DIMENSIONS mismatch' + process.exit(1)", async () => {
    const mismatchSql = mock(async () => [{ dimensions: 768 }]) as unknown as import("postgres").Sql;

    const originalExit = process.exit;
    const mockExit = mock((_code: number) => { throw new Error("process.exit called"); });
    process.exit = mockExit as never;

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mismatchSql,
      toolsRegistry: registry,
    });

    try {
      await runner.init();
      expect.unreachable("init() should have called process.exit(1) on dimension mismatch");
    } catch (e) {
      expect((e as Error).message).toBe("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("Test 5: dimensions match — init() completes normally, no process.exit call", async () => {
    const matchingSql = mock(async () => [{ dimensions: 1536 }]) as unknown as import("postgres").Sql;

    const originalExit = process.exit;
    const mockExit = mock((_code: number) => {});
    process.exit = mockExit as never;

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: matchingSql,
      toolsRegistry: registry,
    });

    try {
      await runner.init();
      expect(mockExit).not.toHaveBeenCalled();
    } finally {
      process.exit = originalExit;
    }
  });
});

describe("EMBD-05: run() wires embeddingProvider at query-time and save-time", () => {
  let registry: ToolsRegistry;

  beforeEach(() => {
    registry = new ToolsRegistry();
    registry.enableTool("test", "dummy");
    lastMemoryManagerInstance = null;
  });

  test("Test 1: run() calls embedQuery(event.Message) once, passes resulting vector to getContext()", async () => {
    const injectedProvider = {
      embed: mock(async (texts: string[]) => texts.map(() => [9, 9, 9])),
      embedQuery: mock(async (_text: string) => [1, 2, 3]),
      dimensions: 1536,
      providerName: "test-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });
    await runner.init();
    await runner.run(makeEvent());

    expect(injectedProvider.embedQuery).toHaveBeenCalledTimes(1);
    expect(injectedProvider.embedQuery).toHaveBeenCalledWith("hello");

    expect(lastMemoryManagerInstance).not.toBeNull();
    const [, , queryVectorArg] = lastMemoryManagerInstance!.getContext.mock.calls[0] as [
      string,
      string,
      number[],
    ];
    expect(queryVectorArg).toEqual([1, 2, 3]);
  });

  test("Test 2: embedQuery() rejection — run() does not throw, falls back to [] queryVector, turn completes", async () => {
    const injectedProvider = {
      embed: mock(async (texts: string[]) => texts.map(() => [9, 9, 9])),
      embedQuery: mock(async (_text: string) => {
        throw new Error("embedding API down");
      }),
      dimensions: 1536,
      providerName: "test-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });
    await runner.init();

    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(result?.brainOutput.fullResponse).toBe("test reply");

    expect(lastMemoryManagerInstance).not.toBeNull();
    const [, , queryVectorArg] = lastMemoryManagerInstance!.getContext.mock.calls[0] as [
      string,
      string,
      number[],
    ];
    expect(queryVectorArg).toEqual([]);
  });

  test("Test 3: run() calls saveContext() with embedding field populated from embed([profileText])", async () => {
    const injectedProvider = {
      embed: mock(async (_texts: string[]) => [[4, 5, 6]]),
      embedQuery: mock(async (_text: string) => [1, 2, 3]),
      dimensions: 1536,
      providerName: "test-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });
    await runner.init();
    await runner.run(makeEvent());

    expect(lastMemoryManagerInstance).not.toBeNull();
    const [saveInput] = lastMemoryManagerInstance!.saveContext.mock.calls[0] as [
      { userId: string; sessionId?: string; embedding?: { userId: string; sessionId: string; embedding: number[] } },
    ];
    expect(saveInput.embedding).toBeDefined();
    expect(saveInput.embedding!.embedding).toEqual([4, 5, 6]);
    expect(saveInput.embedding!.userId).toBe("lead-test-1");
    expect(saveInput.embedding!.sessionId).toBe("lead-abc");
  });

  test("Test 4: save-time embed() rejection — run() does not throw, saveContext() called WITHOUT embedding field", async () => {
    const injectedProvider = {
      embed: mock(async (_texts: string[]) => {
        throw new Error("embedding API down at save-time");
      }),
      embedQuery: mock(async (_text: string) => [1, 2, 3]),
      dimensions: 1536,
      providerName: "test-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });
    await runner.init();

    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(lastMemoryManagerInstance).not.toBeNull();
    expect(lastMemoryManagerInstance!.saveContext).toHaveBeenCalledTimes(1);
    const [saveInput] = lastMemoryManagerInstance!.saveContext.mock.calls[0] as [
      { embedding?: unknown },
    ];
    expect(saveInput.embedding).toBeUndefined();
  });

  test("Test 5: queryVector.length > 0 reaches getContext() — semantic search layer no longer permanently skipped", async () => {
    const injectedProvider = {
      embed: mock(async (texts: string[]) => texts.map(() => [9, 9, 9])),
      embedQuery: mock(async (_text: string) => [0.5, 0.5, 0.5]),
      dimensions: 1536,
      providerName: "test-provider",
    };

    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: mockSql,
      toolsRegistry: registry,
      embeddingProvider: injectedProvider,
    });
    await runner.init();
    await runner.run(makeEvent());

    expect(lastMemoryManagerInstance).not.toBeNull();
    const [, , queryVectorArg] = lastMemoryManagerInstance!.getContext.mock.calls[0] as [
      string,
      string,
      number[],
    ];
    expect(queryVectorArg.length).toBeGreaterThan(0);
  });
});
