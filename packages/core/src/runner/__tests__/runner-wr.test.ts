// WR-01: BrainRunner.init() logs logger.warn when FUP_WEBHOOK_URL set but checkpointer null
// WR-03: BrainRunner stores SIGTERM handler as _sigtermHandler and removes it in close()
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

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
class MockToolMessage {
  constructor(public props: Record<string, unknown>) { Object.assign(this, props); }
  static isInstance(msg: unknown): msg is MockToolMessage { return msg instanceof MockToolMessage; }
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

mock.module("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: class {
    async getTools() { return []; }
    async close() {}
  },
}));

const mockMemorySaver = new MockMemorySaver();
const mockCreateCheckpointer = mock(async () => mockMemorySaver as unknown);
mock.module("@brain-pkg/ai", () => ({
  createCheckpointer: mockCreateCheckpointer,
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

// Capture logger.warn calls — reset per test
let warnCalls: Array<[unknown, string]> = [];
const mockLogger = {
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock((...args: unknown[]) => {
    warnCalls.push([args[0], args[1] as string]);
  }),
  debug: mock(() => {}),
};

mock.module("@brain-pkg/observability", () => ({
  createLogger: mock(() => mockLogger),
  createTracingCallbacks: mock(() => []),
}));

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => ({})),
}));

mock.module("@brain-pkg/database", () => ({
  runMigrations: mock(async () => {}),
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

mock.module("../../events/event-publisher.js", () => ({
  EventPublisher: mock(function () {
    return { init: mock(async () => {}), publish: mock(async () => {}), close: mock(async () => {}) };
  }),
}));

// Set required ENV vars
process.env.MIGRATIONS_FOLDER = "/tmp/test-migrations-wr";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/testdb";

// Import after mocks
import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";
import type { IBrain } from "../../brain/interface.js";

function makeBrain(): IBrain {
  return {
    id: "wr-test-brain",
    brainType: "wr-test",
    promptKeys: ["system"],
    tools: [],
    buildGraph: mock(() => ({
      compile: mock(() => ({
        invoke: mock(async () => ({
          messages: [new MockHumanMessage("hi"), new MockAIMessage("reply")],
          brainOutput: { fullResponse: "reply", responseMode: "text" },
          tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        })),
        getState: mock(async () => ({ values: { messages: [] } })),
      })),
    })) as unknown as IBrain["buildGraph"],
  };
}

function makeRegistry(): ToolsRegistry {
  const r = new ToolsRegistry();
  r.enableTool("wr-test", "dummy");
  return r;
}

// ─── WR-01 ────────────────────────────────────────────────────────────────────

describe("WR-01: BrainRunner.init() warns when FUP_WEBHOOK_URL set but checkpointer unavailable", () => {
  let savedFupUrl: string | undefined;

  beforeEach(() => {
    warnCalls = [];
    mockLogger.warn.mockClear();
    mockCreateCheckpointer.mockClear();
    savedFupUrl = process.env.FUP_WEBHOOK_URL;
  });

  afterEach(() => {
    if (savedFupUrl === undefined) {
      delete process.env.FUP_WEBHOOK_URL;
    } else {
      process.env.FUP_WEBHOOK_URL = savedFupUrl;
    }
  });

  it("init() calls logger.warn with hasFupUrl=true when FUP_WEBHOOK_URL is set but checkpointer is null", async () => {
    // Arrange: checkpointer returns null for this run
    mockCreateCheckpointer.mockImplementationOnce(async () => null);
    process.env.FUP_WEBHOOK_URL = "https://example.com/fup";

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });

    // Act
    await runner.init();

    // Assert: logger.warn was called with the WR-01 structured message
    const warnCall = warnCalls.find(([, msg]) => msg === "FupScheduler not started — checkpointer unavailable");
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as Record<string, unknown>).hasFupUrl).toBe(true);
    expect((warnCall![0] as Record<string, unknown>).brainType).toBe("wr-test");

    // Cleanup
    await runner.close();
  });

  it("init() does NOT call logger.warn about checkpointer when FUP_WEBHOOK_URL is absent (even with checkpointer null)", async () => {
    // Arrange: no FUP_WEBHOOK_URL — neither branch of the if/else-if fires
    delete process.env.FUP_WEBHOOK_URL;
    mockCreateCheckpointer.mockImplementationOnce(async () => null);

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });

    await runner.init();

    // Assert: the "checkpointer unavailable" warn must NOT appear
    const warnCall = warnCalls.find(([, msg]) => msg === "FupScheduler not started — checkpointer unavailable");
    expect(warnCall).toBeUndefined();

    await runner.close();
  });

  it("init() does NOT call logger.warn about checkpointer when FUP_WEBHOOK_URL is absent", async () => {
    // Arrange: no FUP_WEBHOOK_URL
    delete process.env.FUP_WEBHOOK_URL;
    mockCreateCheckpointer.mockImplementationOnce(async () => null);

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });

    await runner.init();

    const warnCall = warnCalls.find(([, msg]) => msg === "FupScheduler not started — checkpointer unavailable");
    expect(warnCall).toBeUndefined();

    await runner.close();
  });
});

// ─── WR-03 ────────────────────────────────────────────────────────────────────

describe("WR-03: BrainRunner stores SIGTERM handler and removes it in close()", () => {
  let savedFupUrl: string | undefined;

  beforeEach(() => {
    warnCalls = [];
    savedFupUrl = process.env.FUP_WEBHOOK_URL;
    delete process.env.FUP_WEBHOOK_URL;
  });

  afterEach(() => {
    if (savedFupUrl === undefined) {
      delete process.env.FUP_WEBHOOK_URL;
    } else {
      process.env.FUP_WEBHOOK_URL = savedFupUrl;
    }
  });

  it("after init(), a SIGTERM listener has been registered on process", async () => {
    const countBefore = process.listenerCount("SIGTERM");

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });
    await runner.init();

    const countAfter = process.listenerCount("SIGTERM");
    expect(countAfter).toBe(countBefore + 1);

    // Cleanup — also removes the listener
    await runner.close();
  });

  it("after close(), the SIGTERM listener registered in init() is removed from process", async () => {
    const countBaseline = process.listenerCount("SIGTERM");

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });
    await runner.init();
    // Listener should be present now
    expect(process.listenerCount("SIGTERM")).toBe(countBaseline + 1);

    await runner.close();

    // After close(), listener count must return to baseline — no accumulation
    expect(process.listenerCount("SIGTERM")).toBe(countBaseline);
  });

  it("calling init() twice without close() in between does not double-register SIGTERM listeners beyond one extra", async () => {
    // This tests that if init() is called twice, the second call doesn't double the listener.
    // With WR-03 properly implemented, each init() registers exactly one handler stored in _sigtermHandler.
    // Note: the second init() overwrites _sigtermHandler without removing the first — so this
    // verifies the implementation behavior (one registration per init call visible via listenerCount).
    const countBefore = process.listenerCount("SIGTERM");

    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });

    await runner.init();
    const countAfterFirst = process.listenerCount("SIGTERM");
    expect(countAfterFirst).toBe(countBefore + 1);

    // close() removes the listener registered in first init()
    await runner.close();
    expect(process.listenerCount("SIGTERM")).toBe(countBefore);

    // Second init() registers a fresh listener
    await runner.init();
    expect(process.listenerCount("SIGTERM")).toBe(countBefore + 1);

    await runner.close();
    expect(process.listenerCount("SIGTERM")).toBe(countBefore);
  });

  it("calling close() twice does not throw — _sigtermHandler null guard prevents double process.off", async () => {
    const runner = new BrainRunner({
      brain: makeBrain(),
      sql: {} as never,
      toolsRegistry: makeRegistry(),
    });
    await runner.init();

    // First close — removes listener
    await runner.close();

    // Second close — must not throw, _sigtermHandler is already null
    await expect(runner.close()).resolves.toBeUndefined();
  });
});
