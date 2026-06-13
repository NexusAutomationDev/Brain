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
  })),
}));

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => ({})),
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
});
