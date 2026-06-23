// LEAD-02: LeadService — upsert por numero, uniqueId nunca sobrescrito
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock drizzle-orm/postgres-js ANTES do import do LeadService
const mockReturning = mock(async () => [
  {
    id: "uuid-1",
    uniqueId: "lead-abc",
    numero: "5511999990001",
    nome: "João",
    iaAtivada: true,
    fullpp: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]);
const mockOnConflictDoUpdate = mock(() => ({ returning: mockReturning }));
const mockValues = mock(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = mock(() => ({ values: mockValues }));
const mockLimit = mock(async () => []);
const mockWhere = mock(() => ({ limit: mockLimit }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));
const mockDb = { insert: mockInsert, select: mockSelect };

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));

// Mock drizzle-orm para eq()
mock.module("drizzle-orm", () => ({
  eq: mock((col: unknown, val: unknown) => ({ col, val })),
}));

// Mock @brain-pkg/database para leads
mock.module("@brain-pkg/database", () => ({
  leads: {
    numero: "leads.numero",
    uniqueId: "leads.unique_id",
    nome: "leads.nome",
    iaAtivada: "leads.ia_ativada",
    fullpp: "leads.fullpp",
    createdAt: "leads.created_at",
    updatedAt: "leads.updated_at",
    id: "leads.id",
    // FUP-06: novas colunas adicionadas na migration 0007_v1_4_foundation
    lastMessageAt: "leads.last_message_at",
    fupEnabled: "leads.fup_enabled",
    fupStep: "leads.fup_step",
    fupNextAt: "leads.fup_next_at",
  },
}));

import { LeadService } from "../lead-service.js";

describe("LeadService (LEAD-02)", () => {
  let service: LeadService;

  beforeEach(() => {
    mockReturning.mockClear();
    mockOnConflictDoUpdate.mockClear();
    mockValues.mockClear();
    mockInsert.mockClear();
    service = new LeadService({} as never);
  });

  it("upsertLead retorna lead com campos esperados para numero novo", async () => {
    const lead = await service.upsertLead("5511999990001", "lead-abc", "João");
    expect(lead).toHaveProperty("id");
    expect(lead.uniqueId).toBe("lead-abc");
    expect(lead.numero).toBe("5511999990001");
    expect(lead.iaAtivada).toBe(true);
  });

  it("upsertLead chama onConflictDoUpdate com target leads.numero (LEAD-02: uniqueId nunca sobrescrito)", async () => {
    await service.upsertLead("5511999990001", "lead-abc", "João");
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0] as Record<string, unknown>;
    // set NÃO deve conter uniqueId (LEAD-02: nunca sobrescrito)
    expect(callArg.set).not.toHaveProperty("uniqueId");
  });

  it("upsertLead com nome undefined inclui updatedAt no set mas nao uniqueId", async () => {
    await service.upsertLead("5511999990001", "lead-abc");
    const setArg = (mockOnConflictDoUpdate.mock.calls[0][0] as Record<string, unknown>).set as Record<string, unknown>;
    expect(setArg).toHaveProperty("updatedAt");
    expect(setArg).not.toHaveProperty("uniqueId");
  });
});

describe("LeadService — métodos de atualização de lead (TOOLS-STD-01, TOOLS-STD-02)", () => {
  // Mock para o chain update → set → where
  const mockWhere2 = mock(async () => []);
  const mockSet2 = mock(() => ({ where: mockWhere2 }));
  const mockUpdate2 = mock(() => ({ set: mockSet2 }));

  let service2: LeadService;

  beforeEach(() => {
    mockWhere2.mockClear();
    mockSet2.mockClear();
    mockUpdate2.mockClear();
    // Injetar update no mockDb compartilhado (mesmo objeto retornado pelo drizzle mock)
    (mockDb as Record<string, unknown>).update = mockUpdate2;
    service2 = new LeadService({} as never);
  });

  it("setFullpp() chama db.update com { fullpp: value, updatedAt } onde eq(leads.uniqueId, uniqueId)", async () => {
    await service2.setFullpp("lead-abc", false);
    expect(mockUpdate2).toHaveBeenCalledTimes(1);
    expect(mockSet2).toHaveBeenCalledTimes(1);
    const setArg = mockSet2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("fullpp", false);
    expect(setArg).toHaveProperty("updatedAt");
  });

  it("setIaAtivada() chama db.update com { iaAtivada: value, updatedAt } onde eq(leads.uniqueId, uniqueId)", async () => {
    await service2.setIaAtivada("lead-abc", false);
    expect(mockUpdate2).toHaveBeenCalledTimes(1);
    expect(mockSet2).toHaveBeenCalledTimes(1);
    const setArg = mockSet2.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("iaAtivada", false);
    expect(setArg).toHaveProperty("updatedAt");
  });
});

describe("LeadService — touchLastMessage (FUP-06)", () => {
  const mockWhere3 = mock(async () => []);
  const mockSet3 = mock(() => ({ where: mockWhere3 }));
  const mockUpdate3 = mock(() => ({ set: mockSet3 }));

  let service3: LeadService;

  beforeEach(() => {
    mockWhere3.mockClear();
    mockSet3.mockClear();
    mockUpdate3.mockClear();
    (mockDb as Record<string, unknown>).update = mockUpdate3;
    service3 = new LeadService({} as never);
  });

  it("touchLastMessage() chama db.update com { lastMessageAt: Date } onde eq(leads.uniqueId, uniqueId)", async () => {
    await service3.touchLastMessage("lead-abc");
    expect(mockUpdate3).toHaveBeenCalledTimes(1);
    expect(mockSet3).toHaveBeenCalledTimes(1);
    const setArg = mockSet3.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("lastMessageAt");
    expect(setArg.lastMessageAt).toBeInstanceOf(Date);
  });

  it("touchLastMessage() NÃO inclui updatedAt no set (D-11: last_message_at é coluna especializada)", async () => {
    await service3.touchLastMessage("lead-abc");
    const setArg = mockSet3.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("updatedAt");
  });

  it("touchLastMessage() chama where com leads.uniqueId (eq chamado com uniqueId correto)", async () => {
    await service3.touchLastMessage("lead-abc");
    expect(mockWhere3).toHaveBeenCalledTimes(1);
  });
});
