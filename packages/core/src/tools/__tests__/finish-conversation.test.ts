// TOOLS-STD-02: finish_conversation tool — scaffold Wave 0 (RED)
// Testa createFinishConversationTool: atualiza leads.iaAtivada=false E leads.fullpp=false em um único UPDATE (atomicidade)
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock drizzle e leads ANTES do import da tool
const mockWhere = mock(async () => []);
const mockSet = mock(() => ({ where: mockWhere }));
const mockUpdate = mock(() => ({ set: mockSet }));
const mockDb = { update: mockUpdate };

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));

mock.module("drizzle-orm", () => ({
  eq: mock((col: unknown, val: unknown) => ({ col, val })),
}));

mock.module("@brain-pkg/database", () => ({
  leads: {
    uniqueId: "leads.unique_id",
    fullpp: "leads.fullpp",
    iaAtivada: "leads.ia_ativada",
    updatedAt: "leads.updated_at",
  },
}));

// WAVE 0: Este import falhará com "Cannot find module" — estado RED esperado
import { createFinishConversationTool } from "../finish-conversation.js";

describe("createFinishConversationTool (TOOLS-STD-02)", () => {
  beforeEach(() => {
    mockWhere.mockClear();
    mockSet.mockClear();
    mockUpdate.mockClear();
  });

  test("invoca db.update com iaAtivada=false E fullpp=false em um único update quando thread_id presente", async () => {
    const tool = createFinishConversationTool({} as never);
    const result = await tool.invoke(
      {},
      { configurable: { thread_id: "lead-xyz" } }
    );
    expect(result).toContain("encerrada");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("set atômico: mockSet chamado com { iaAtivada: false, fullpp: false } no mesmo update", async () => {
    const tool = createFinishConversationTool({} as never);
    await tool.invoke({}, { configurable: { thread_id: "lead-xyz" } });
    expect(mockSet.mock.calls[0]?.[0]).toMatchObject({ iaAtivada: false, fullpp: false });
  });

  test("retorna string de erro quando thread_id ausente", async () => {
    const tool = createFinishConversationTool({} as never);
    const result = await tool.invoke({}, {});
    expect(result).toContain("thread_id não disponível");
  });

  test("name da tool é 'finish_conversation'", () => {
    const tool = createFinishConversationTool({} as never);
    expect(tool.name).toBe("finish_conversation");
  });
});
