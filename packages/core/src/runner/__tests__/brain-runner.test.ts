// SDK-02: BrainRunner — lifecycle init() + run() returning { reply: string }
// Uses MemorySaver in tests (AI-01 allows MemorySaver ONLY in *.test.ts)
import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { BrainEvent } from "@brain-pkg/transport";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

// --- Mocks setup (before imports that use them) ---

const mockLoadPrompts = mock(async () => ({
  "system": "You are a test assistant",
}));

mock.module("../../prompts/loader.js", () => ({
  loadPrompts: mockLoadPrompts,
}));

// Mock createCheckpointer to use MemorySaver (AI-01: allowed in *.test.ts)
const { MemorySaver } = await import("@langchain/langgraph");
const mockMemorySaver = new MemorySaver();
mock.module("@brain-pkg/ai", () => ({
  createCheckpointer: mock(async () => mockMemorySaver),
  createLLM: mock(async () => ({ invoke: mock(async () => new AIMessage("test reply")) })),
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
}));

// Satisfy MIGRATIONS_FOLDER check in runner.init() — prevents process.exit(1) before runMigrations
process.env.MIGRATIONS_FOLDER = "/tmp/test-migrations";

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
            new HumanMessage("hello"),
            new AIMessage("test reply"),
          ],
        })),
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

  test("run(event) returns { reply: string } with the last AIMessage content", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: {} as never,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    expect(result).toHaveProperty("reply");
    expect(typeof result.reply).toBe("string");
    expect(result.reply).toBe("test reply");
  });

  test("run(event) does NOT expose LangGraph internal state in the return value", async () => {
    const brain = makeBrain(["system"]);
    const runner = new BrainRunner({
      brain,
      sql: {} as never,
      toolsRegistry: registry,
    });

    await runner.init();
    const result = await runner.run(makeEvent());

    // Only 'reply' is allowed — no messages, state, checkpoint, etc.
    expect(Object.keys(result)).toEqual(["reply"]);
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

    test("run() retorna { reply } quando iaAtivada=true", async () => {
      // mockUpsertLead default já retorna iaAtivada: true — sem override necessário
      const brain = makeBrain(["system"]);
      const runner = new BrainRunner({ brain, sql: {} as never, toolsRegistry: registry });
      await runner.init();

      const result = await runner.run(makeEvent());
      expect(result).not.toBeNull();
      expect(result?.reply).toBe("test reply");
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
});
