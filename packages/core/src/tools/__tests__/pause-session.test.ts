// TOOLS-STD-01: pause_session tool — scaffold Wave 0 (RED)
// Testa createPauseSessionTool: atualiza leads.fullpp=false via thread_id do RunnableConfig
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
import { createPauseSessionTool } from "../pause-session.js";

describe("createPauseSessionTool (TOOLS-STD-01)", () => {
  beforeEach(() => {
    mockWhere.mockClear();
    mockSet.mockClear();
    mockUpdate.mockClear();
  });

  test("invoca db.update com fullpp=false quando thread_id está presente no config", async () => {
    const tool = createPauseSessionTool({} as never);
    const result = await tool.invoke(
      {},
      { configurable: { thread_id: "lead-abc" } }
    );
    expect(result).toContain("pausada");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("retorna string de erro quando thread_id ausente no config", async () => {
    const tool = createPauseSessionTool({} as never);
    const result = await tool.invoke({}, {});
    expect(result).toContain("thread_id não disponível");
  });

  test("retorna string de erro quando config é undefined", async () => {
    const tool = createPauseSessionTool({} as never);
    // @ts-expect-error — testando caso sem config
    const result = await tool.invoke({});
    expect(result).toContain("thread_id não disponível");
  });

  test("name da tool é 'pause_session'", () => {
    const tool = createPauseSessionTool({} as never);
    expect(tool.name).toBe("pause_session");
  });
});
