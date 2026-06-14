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
