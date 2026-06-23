// FUP-06: BrainRunner.run() chama touchLastMessage() ANTES do gate ia_ativada
import { describe, it, expect, mock, beforeEach } from "bun:test";
type BrainEvent = { Name: string; Message: string; Numero: string; IDLead: string };

// --- Mocks (before any imports that use them) ---

const mockLoadPrompts = mock(async () => ({ system: "test prompt" }));
const mockUpsertPrompts = mock(async () => {});
mock.module("../../prompts/loader.js", () => ({
  loadPrompts: mockLoadPrompts,
  upsertPrompts: mockUpsertPrompts,
}));

class MockMemorySaver { storage: Record<string, unknown> = {}; }
class MockAIMessage { constructor(public content: string) {} }
class MockHumanMessage { constructor(public content: string) {} }

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

mock.module("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: class {
    async getTools() { return []; }
    async close() {}
  },
}));

const mockMemorySaver = new MockMemorySaver();
mock.module("@brain-pkg/ai", () => ({
  createCheckpointer: mock(async () => mockMemorySaver),
  createLLM: mock(async () => ({ invoke: mock(async () => new MockAIMessage("reply")) })),
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
  createLogger: mock(() => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  })),
  createTracingCallbacks: mock(() => []),
}));

mock.module("@brain-pkg/database", () => ({
  runMigrations: mock(async () => {}),
}));

mock.module("@brain-pkg/shared", () => ({
  ConfigurationError: class extends Error {},
  BrainOutputValidationError: class extends Error {},
}));

// Mock mockTouchLastMessage para rastrear chamadas
const mockTouchLastMessage = mock(async (_uniqueId: string) => {});
const mockUpsertLead = mock(async () => ({
  id: "uuid-1",
  uniqueId: "lead-fup-test",
  numero: "5511999990001",
  nome: "Test",
  iaAtivada: true,
  fullpp: null,
  idDeal: null,
  idContato: null,
  fupEnabled: false,
  fupStep: 0,
  fupNextAt: null,
  lastMessageAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

mock.module("../../leads/lead-service.js", () => ({
  LeadService: mock(function () {
    return {
      upsertLead: mockUpsertLead,
      touchLastMessage: mockTouchLastMessage,
    };
  }),
}));

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => ({})),
}));

// Mock do compiledGraph — retorna brainOutput válido
const mockBrainOutput = {
  reply: "ok",
  fullResponse: "ok",
  responseMode: "text",
  action: null,
};

const mockGetState = mock(async () => ({ values: { messages: [] } }));
const mockInvoke = mock(async () => ({
  brainOutput: mockBrainOutput,
  tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
}));
const mockCompiledGraph = {
  getState: mockGetState,
  invoke: mockInvoke,
};

const mockBrainOutputSchema = {
  parse: mock((v: unknown) => v),
};
mock.module("../output/schema.js", () => ({
  BrainOutputSchema: mockBrainOutputSchema,
}));

const mockBuildGraph = mock(() => ({
  compile: mock(() => mockCompiledGraph),
}));

import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";

const mockBrain = {
  id: "brain-fup-test",
  brainType: "fup-test",
  promptKeys: ["system"],
  tools: [],
  defaultPrompts: undefined,
  buildGraph: mockBuildGraph,
};

describe("BrainRunner.run() — FUP-06: touchLastMessage antes do gate ia_ativada", () => {
  let runner: BrainRunner;
  let toolsRegistry: ToolsRegistry;

  beforeEach(async () => {
    mockTouchLastMessage.mockClear();
    mockUpsertLead.mockClear();
    mockGetState.mockClear();
    mockInvoke.mockClear();

    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    process.env.MIGRATIONS_FOLDER = "/tmp/fake-migrations";

    toolsRegistry = new ToolsRegistry();
    toolsRegistry.enableTool("fup-test", "dummy"); // register brainType to avoid ConfigurationError

    runner = new BrainRunner({
      brain: mockBrain as never,
      sql: {} as never,
      toolsRegistry,
      migrationsFolder: "/tmp/fake-migrations",
    });
    await runner.init();
  });

  it("touchLastMessage() é chamado quando lead.iaAtivada=true (caminho normal)", async () => {
    mockUpsertLead.mockResolvedValueOnce({
      id: "uuid-1", uniqueId: "lead-fup-test", numero: "5511999990001",
      nome: "Test", iaAtivada: true, fullpp: null, idDeal: null, idContato: null,
      fupEnabled: false, fupStep: 0, fupNextAt: null, lastMessageAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const event: BrainEvent = { Name: "Test", Message: "Olá", Numero: "5511999990001", IDLead: "lead-fup-test" };
    await runner.run(event as never);

    expect(mockTouchLastMessage).toHaveBeenCalledTimes(1);
    expect(mockTouchLastMessage.mock.calls[0]?.[0]).toBe("lead-fup-test");
  });

  it("touchLastMessage() é chamado MESMO quando lead.iaAtivada=false (FUP-06)", async () => {
    mockUpsertLead.mockResolvedValueOnce({
      id: "uuid-2", uniqueId: "lead-ia-off", numero: "5511999990002",
      nome: "Test2", iaAtivada: false, fullpp: null, idDeal: null, idContato: null,
      fupEnabled: false, fupStep: 0, fupNextAt: null, lastMessageAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const event: BrainEvent = { Name: "Test2", Message: "Oi", Numero: "5511999990002", IDLead: "lead-ia-off" };
    const result = await runner.run(event as never);

    // Gate retorna null (ia_ativada=false) MAS touchLastMessage foi chamado antes
    expect(result).toBeNull();
    expect(mockTouchLastMessage).toHaveBeenCalledTimes(1);
    expect(mockTouchLastMessage.mock.calls[0]?.[0]).toBe("lead-ia-off");
  });

  it("touchLastMessage() é chamado ANTES do gate: invoke() NÃO é chamado quando ia_ativada=false", async () => {
    mockUpsertLead.mockResolvedValueOnce({
      id: "uuid-3", uniqueId: "lead-ia-off-2", numero: "5511999990003",
      nome: "Test3", iaAtivada: false, fullpp: null, idDeal: null, idContato: null,
      fupEnabled: false, fupStep: 0, fupNextAt: null, lastMessageAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as never);

    const event: BrainEvent = { Name: "Test3", Message: "Oi", Numero: "5511999990003", IDLead: "lead-ia-off-2" };
    await runner.run(event as never);

    // touchLastMessage chamado, invoke não (gate bloqueou)
    expect(mockTouchLastMessage).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
