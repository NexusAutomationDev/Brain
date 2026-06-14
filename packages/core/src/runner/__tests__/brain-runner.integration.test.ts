// Integration test: BrainRunner end-to-end with real PostgreSQL
// This test requires a running PostgreSQL instance with brain_test database
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import { prompts, leads } from "@brain-pkg/database";
import type { BrainEvent } from "@brain-pkg/transport";
import { BrainRunner } from "../runner.js";
import { ToolsRegistry } from "../../tools/registry.js";
import type { IBrain } from "../../brain/interface.js";
import { StateGraph } from "@langchain/langgraph";
import { BrainStateAnnotation } from "@brain-pkg/ai";

// Test configuration
const TEST_DB_URL = process.env.POSTGRES_URL ?? process.env.TEST_DATABASE_URL;

// Skip all integration tests gracefully when DB not available (avoids crashing unit test runs)
const describeOrSkip = TEST_DB_URL ? describe : describe.skip;

describeOrSkip("BrainRunner Integration", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  // History-aware brain: encodes state.messages.length in the reply so asserts
  // can verify checkpoint accumulation without accessing the private compiledGraph.
  // (Pitfall 5: compiledGraph is private — verify indirectly via result.reply)
  const historyAwareBrain: IBrain = {
    id: "test-hist",
    brainType: "integration-test",
    promptKeys: ["system"],
    tools: [],
    buildGraph: (_context) => {
      const graph = new StateGraph(BrainStateAnnotation);
      graph.addNode("respond", async (state: any) => {
        const msgCount = (state.messages ?? []).length;
        return {
          messages: [
            { role: "ai", content: `reply:msgCount=${msgCount}` },
          ],
        };
      });
      graph.setEntryPoint("respond");
      return graph;
    },
  };

  beforeAll(async () => {
    // Connect to test database
    sql = postgres(TEST_DB_URL);
    db = drizzle(sql);

    // Seed prompts table for test brain
    await db.insert(prompts).values({
      brainType: "integration-test",
      key: "system",
      content: "You are a helpful assistant. Always respond with 'Integration test reply'.",
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    // Cleanup prompts seeded by this test suite
    await db.delete(prompts).where(eq(prompts.brainType, "integration-test"));

    // Cleanup leads created by HIST-00, HIST-01, and HIST-02 tests
    await db.delete(leads).where(
      inArray(leads.numero, [
        "5511999990001", // HIST-00
        "5511111111111", // HIST-01 event1
        "5519999999999", // HIST-01 event2
        "5511222222222", // HIST-02
      ])
    );

    await sql.end();
  });

  // ---------------------------------------------------------------------------
  // HIST-00: Basic end-to-end smoke test (original test, kept for regression)
  // ---------------------------------------------------------------------------
  test("HIST-00: BrainRunner basic end-to-end with PostgreSQL", async () => {
    // Create a minimal test brain
    const testBrain: IBrain = {
      id: "test-integration",
      brainType: "integration-test",
      promptKeys: ["system"],
      tools: [],
      buildGraph: (context) => {
        const graph = new StateGraph(BrainStateAnnotation);
        // Simple graph that just echoes
        graph.addNode("respond", async (state: any) => {
          return {
            messages: [
              { role: "human", content: "hello" },
              { role: "ai", content: "Integration test reply" },
            ],
          };
        });
        graph.setEntryPoint("respond");
        return graph;
      },
    };

    // Create tools registry
    const registry = new ToolsRegistry();
    registry.enableTool("integration-test", "dummy");

    // Create BrainRunner
    const runner = new BrainRunner({
      brain: testBrain,
      sql,
      toolsRegistry: registry,
    });

    // Test init()
    await runner.init();
    console.log("✓ init() completed successfully");

    // Test run()
    const event: BrainEvent = {
      Name: "Test User Integration",
      Message: "hello",
      Numero: "5511999990001",
      IDLead: "lead-integration-1",
    };

    const result = await runner.run(event);

    // Assertions
    expect(result).toHaveProperty("reply");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    expect(Object.keys(result)).toEqual(["reply"]); // No state leak

    console.log("✓ run() returned:", result);

    // Test memory persistence (second call with same thread_id)
    const event2: BrainEvent = {
      Name: "Test User Integration",
      Message: "remember that",
      Numero: "5511999990001",
      IDLead: "lead-integration-1",
    };

    const result2 = await runner.run(event2);
    expect(result2).toHaveProperty("reply");
    console.log("✓ Second call completed:", result2);
  }, 30000); // 30s timeout for real DB operations

  // ---------------------------------------------------------------------------
  // HIST-01: thread_id = lead.uniqueId (IDLead canônico), não event.Numero
  // Verifica que dois eventos com mesmo IDLead mas Numeros DIFERENTES compartilham
  // o mesmo checkpoint — provando que thread_id deriva do IDLead, não do Numero.
  // ---------------------------------------------------------------------------
  test("HIST-01: thread_id = IDLead canônico, não event.Numero", async () => {
    const registry = new ToolsRegistry();
    registry.enableTool("integration-test", "dummy");
    const runner = new BrainRunner({
      brain: historyAwareBrain,
      sql,
      toolsRegistry: registry,
    });
    await runner.init();

    // Mesmo IDLead, Numeros DIFERENTES — se thread_id fosse Numero, o
    // segundo evento não teria histórico do primeiro
    const event1: BrainEvent = {
      Name: "Lead A",
      Message: "primeira mensagem",
      Numero: "5511111111111",     // Numero 1
      IDLead: "lead-hist-001",     // IDLead canônico
    };
    const event2: BrainEvent = {
      Name: "Lead A",
      Message: "segunda mensagem",
      Numero: "5519999999999",     // Numero DIFERENTE
      IDLead: "lead-hist-001",     // mesmo IDLead canônico
    };

    const result1 = await runner.run(event1);
    expect(result1).not.toBeNull();
    // Primeiro turno: nenhuma mensagem no checkpoint ainda — msgCount=0 ou 1 (apenas a mensagem atual)
    expect(result1!.reply).toContain("reply:msgCount=");

    const result2 = await runner.run(event2);
    expect(result2).not.toBeNull();
    // Segundo turno com mesmo IDLead (Numero diferente): deve ver mensagens do turno anterior
    // Se thread_id fosse Numero, segundo turno começaria do zero (msgCount=0 ou 1)
    // Se thread_id for IDLead, segundo turno herda histórico (msgCount > 1)
    const msgCount2 = parseInt(result2!.reply.split("msgCount=")[1] ?? "0", 10);
    expect(msgCount2).toBeGreaterThan(1);
  }, 30000);

  // ---------------------------------------------------------------------------
  // HIST-02: Histórico de conversa persiste entre chamadas com mesmo IDLead
  // Verifica que o PostgresSaver acumula mensagens entre turnos do mesmo lead.
  // ---------------------------------------------------------------------------
  test("HIST-02: histórico de conversa persiste entre chamadas com mesmo IDLead", async () => {
    const registry = new ToolsRegistry();
    registry.enableTool("integration-test", "dummy");
    const runner = new BrainRunner({
      brain: historyAwareBrain,
      sql,
      toolsRegistry: registry,
    });
    await runner.init();

    const baseEvent: BrainEvent = {
      Name: "Lead Hist02",
      Message: "mensagem inicial",
      Numero: "5511222222222",
      IDLead: "lead-hist-002",
    };

    // Primeira chamada — histórico vazio
    const result1 = await runner.run(baseEvent);
    expect(result1).not.toBeNull();
    const msgCount1 = parseInt(result1!.reply.split("msgCount=")[1] ?? "0", 10);

    // Segunda chamada com mesmo IDLead — mesmo runner, deve recuperar checkpoint do PostgresSaver
    const result2 = await runner.run({ ...baseEvent, Message: "mensagem de retorno" });
    expect(result2).not.toBeNull();
    const msgCount2 = parseInt(result2!.reply.split("msgCount=")[1] ?? "0", 10);

    // HIST-02: segundo turno deve ter mais mensagens que o primeiro
    expect(msgCount2).toBeGreaterThan(msgCount1);
  }, 30000);
});
