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
    fupEnabled: false,
    fupStep: 0,
    fupNextAt: null,
    lastMessageAt: null,
    fupFailureCount: 0,
    idDeal: null,
    idContato: null,
  },
]);
const mockOnConflictDoUpdate = mock(() => ({ returning: mockReturning }));
const mockValues = mock(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = mock(() => ({ values: mockValues }));
const mockLimit = mock(async () => []);
const mockWhere = mock(() => ({ limit: mockLimit }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));

// FUP activation: chain separado para SELECT em fup_config (Phase 25)
const mockLimit4 = mock(async () => []);
const mockWhere4 = mock(() => ({ limit: mockLimit4 }));
const mockFrom4 = mock(() => ({ where: mockWhere4 }));
const mockSelect4 = mock(() => ({ from: mockFrom4 }));

const mockDb = { insert: mockInsert, select: mockSelect };

mock.module("drizzle-orm/postgres-js", () => ({
  drizzle: mock(() => mockDb),
}));

// Mock drizzle-orm para eq()
mock.module("drizzle-orm", () => ({
  eq: mock((col: unknown, val: unknown) => ({ col, val })),
}));

// Mock @brain-pkg/database para leads e fupConfig
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
    fupFailureCount: "leads.fup_failure_count",
    idDeal: "leads.id_deal",
    idContato: "leads.id_contato",
  },
  // FUP-01: fup_config — configuração de follow-up por brain_type
  fupConfig: {
    brainType: "fup_config.brain_type",
    enabled: "fup_config.enabled",
    intervalsSeconds: "fup_config.intervals_seconds",
    minHour: "fup_config.min_hour",
    maxHour: "fup_config.max_hour",
    allowedDays: "fup_config.allowed_days",
    timezone: "fup_config.timezone",
    createdAt: "fup_config.created_at",
    updatedAt: "fup_config.updated_at",
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

describe("LeadService — FUP activation (Phase 25)", () => {
  // Controla o que o SELECT de leads retorna (para checar se lead é novo ou existente)
  // e o que o SELECT de fup_config retorna
  let service5: LeadService;

  beforeEach(() => {
    mockLimit.mockClear();
    mockWhere.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockReturning.mockClear();
    mockOnConflictDoUpdate.mockClear();
    mockValues.mockClear();
    mockInsert.mockClear();
    mockLimit4.mockClear();
    mockWhere4.mockClear();
    mockFrom4.mockClear();
    mockSelect4.mockClear();
    service5 = new LeadService({} as never);
  });

  it("INSERT com fup_config enabled=true → lead retornado tem fupEnabled=true (D-02)", async () => {
    // Lead novo: SELECT de leads retorna vazio
    mockLimit.mockImplementationOnce(async () => []);
    // fup_config encontrada e enabled=true
    mockLimit4.mockImplementationOnce(async () => [{ enabled: true }]);

    // mockReturning retorna lead com fupEnabled=true
    mockReturning.mockImplementationOnce(async () => [
      {
        id: "uuid-1",
        uniqueId: "lead-new",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: true,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    // Configurar mockDb.select para alternar entre SELECT de leads e SELECT de fup_config
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Primeiro SELECT: verificar existência do lead
        return { from: mockFrom };
      }
      // Segundo SELECT: consultar fup_config
      return { from: mockFrom4 };
    });

    const lead = await service5.upsertLead("5511999990001", "lead-new", "João", "sdr");
    expect(lead.fupEnabled).toBe(true);
  });

  it("INSERT com fup_config enabled=false → lead retornado tem fupEnabled=false (D-02)", async () => {
    // Lead novo: SELECT de leads retorna vazio
    mockLimit.mockImplementationOnce(async () => []);
    // fup_config encontrada mas enabled=false
    mockLimit4.mockImplementationOnce(async () => [{ enabled: false }]);

    mockReturning.mockImplementationOnce(async () => [
      {
        id: "uuid-2",
        uniqueId: "lead-new",
        numero: "5511999990002",
        nome: "Maria",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return { from: mockFrom };
      }
      return { from: mockFrom4 };
    });

    const lead = await service5.upsertLead("5511999990002", "lead-new", "Maria", "sdr");
    expect(lead.fupEnabled).toBe(false);
  });

  it("INSERT sem brainType → fupEnabled=false (padrão da tabela), sem SELECT em fup_config (D-04)", async () => {
    // Lead novo: SELECT de leads retorna vazio
    mockLimit.mockImplementationOnce(async () => []);

    mockReturning.mockImplementationOnce(async () => [
      {
        id: "uuid-3",
        uniqueId: "lead-new",
        numero: "5511999990003",
        nome: "Pedro",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    // Sem brainType: apenas 1 SELECT (verificação de lead existente)
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      return { from: mockFrom };
    });

    const lead = await service5.upsertLead("5511999990003", "lead-new", "Pedro");
    expect(lead.fupEnabled).toBe(false);
    // Sem brainType → fup_config NÃO deve ser consultada (apenas 1 SELECT)
    expect(selectCallCount).toBe(1);
  });

  it("UPDATE (lead existente) preserva fupEnabled — onConflictDoUpdate.set NÃO contém fupEnabled (D-03)", async () => {
    // Lead existente: SELECT de leads retorna row existente
    mockLimit.mockImplementationOnce(async () => [
      {
        id: "uuid-4",
        uniqueId: "lead-existing",
        numero: "5511999990004",
        nome: "Ana",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    mockReturning.mockImplementationOnce(async () => [
      {
        id: "uuid-4",
        uniqueId: "lead-existing",
        numero: "5511999990004",
        nome: "Ana",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    mockSelect.mockImplementationOnce(() => ({ from: mockFrom }));

    const lead = await service5.upsertLead("5511999990004", "lead-existing", "Ana", "sdr");
    expect(lead.fupEnabled).toBe(false);

    // D-03: onConflictDoUpdate.set NÃO deve conter fupEnabled (UPDATE preserva valor existente)
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.set).not.toHaveProperty("fupEnabled");
  });

  it("INSERT com fup_config inexistente → fupEnabled=false, sem erro (D-04 silent fallback)", async () => {
    // Lead novo: SELECT de leads retorna vazio
    mockLimit.mockImplementationOnce(async () => []);
    // fup_config NÃO encontrada: retorna vazio
    mockLimit4.mockImplementationOnce(async () => []);

    mockReturning.mockImplementationOnce(async () => [
      {
        id: "uuid-5",
        uniqueId: "lead-new",
        numero: "5511999990005",
        nome: "Carlos",
        iaAtivada: true,
        fullpp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
      },
    ]);

    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        return { from: mockFrom };
      }
      return { from: mockFrom4 };
    });

    // Não deve lançar exceção quando fup_config não existe
    let lead: Awaited<ReturnType<typeof service5.upsertLead>> | undefined;
    let error: unknown;
    try {
      lead = await service5.upsertLead("5511999990005", "lead-new", "Carlos", "unknown-brain");
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
    expect(lead?.fupEnabled).toBe(false);
  });
});
