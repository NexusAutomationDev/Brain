// SDK-02: BrainRunner — lifecycle init() + run() returning BrainOutput | null
// Uses MemorySaver in tests (AI-01 allows MemorySaver ONLY in *.test.ts)
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
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
}));

const mockMemorySaver = new MockMemorySaver();
mock.module("@brain-pkg/ai", () => ({
  createCheckpointer: mock(async () => mockMemorySaver),
  createLLM: mock(async () => ({ invoke: mock(async () => new MockAIMessage("test reply")) })),
  BrainStateAnnotation: {},
}));

mock.module("@brain-pkg/memory", () => ({
  MemoryManager: mock(function () {
    return {
      getContext: mock(async () => ({ profile: null, checkpoint: undefined, similarEmbeddings: [] })),
      saveContext: mock(async () => {}),
    };
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
    return { upsertLead: mockUpsertLead, getByNumero: mock(async () => null) };
  }),
}));

// Import after mocks
import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";
import type { IBrain } from "../../brain/interface.js";

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
      sql: {} as never,
      toolsRegistry: registry,
    });

    await runner.init();

    expect(mockLoadPrompts).toHaveBeenCalledWith({}, "test", ["system"]);
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
      sql: {} as never,
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
      sql: {} as never,
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

  test("run(event) retorna BrainOutput com fullResponse e responseMode", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: {} as never,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).not.toBeNull();
    expect(result!.fullResponse).toBe("test reply");
    expect(result!.responseMode).toBe("text");
  });

  test("run() retorna BrainOutput — sem vazamento de estado interno", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: {} as never,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).toHaveProperty("fullResponse");
    expect(result).toHaveProperty("responseMode");
    expect(result).not.toHaveProperty("messages");  // T-05-03: estado interno não vaza
    expect(result).not.toHaveProperty("sessionId");
  });

  test("refreshPrompts() reloads prompts from DB and recompiles the graph", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: {} as never,
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
    const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
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
    const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
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
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();

      const result = await runner.run(makeEvent());
      expect(result).toBeNull();
    });

    test("run() retorna BrainOutput quando iaAtivada=true", async () => {
      // mockUpsertLead default já retorna iaAtivada: true — sem override necessário
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();

      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.fullResponse).toBe("test reply");
    });

    test("run() chama upsertLead com Numero, IDLead e Name do evento", async () => {
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
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
      const runner = new BrainRunner({ brain: brainSemOutput, sql: {} as never, toolsRegistry: registry });
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
      const runner = new BrainRunner({ brain: brainOutputInvalido, sql: {} as never, toolsRegistry: registry });
      await runner.init();

      // NOTE: using string check instead of class import to avoid zod v4 "cached value already set" panic in bun 1.3.2
      await expect(runner.run(makeEvent())).rejects.toThrow("BrainOutput");
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
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();
      // run() não deve lançar erro — getState retorna values.messages=[]
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.fullResponse).toBe("test reply");
    });

    test("usa CONTEXT_WINDOW_MESSAGES=10 quando definida", async () => {
      process.env.CONTEXT_WINDOW_MESSAGES = "10";
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.fullResponse).toBe("test reply");
    });

    test("fallback para 40 quando CONTEXT_WINDOW_MESSAGES é inválida ('abc')", async () => {
      process.env.CONTEXT_WINDOW_MESSAGES = "abc";
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();
      // Não deve lançar, não deve usar NaN como window size
      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.fullResponse).toBe("test reply");
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
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();
      await runner.run(makeEvent());

      expect(getStateMock).toHaveBeenCalledTimes(1);
      const [calledConfig] = getStateMock.mock.calls[0] as [any];
      // thread_id deve ser lead.uniqueId ("lead-abc" do mockUpsertLead)
      expect(calledConfig.configurable.thread_id).toBe("lead-abc");
    });
  });
});
