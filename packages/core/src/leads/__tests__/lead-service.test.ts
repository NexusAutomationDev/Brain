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
  // Chain de SELECT para fup_config — cada teste configura o retorno via mockImplementation
  const mockLimit4 = mock(async () => [] as Array<{ brainType: string; enabled: boolean }>);
  const mockWhere4 = mock(() => ({ limit: mockLimit4 }));
  const mockFrom4 = mock(() => ({ where: mockWhere4 }));
  const mockSelect4 = mock(() => ({ from: mockFrom4 }));

  let service4: LeadService;

  beforeEach(() => {
    mockLimit4.mockClear();
    mockWhere4.mockClear();
    mockFrom4.mockClear();
    mockSelect4.mockClear();
    mockReturning.mockClear();
    mockOnConflictDoUpdate.mockClear();
    mockValues.mockClear();
    mockInsert.mockClear();
    // Substituir select no mockDb para usar o chain de fup_config
    (mockDb as Record<string, unknown>).select = mockSelect4;
    service4 = new LeadService({} as never);
  });

  it("Test 1 (INSERT + config enabled): upsertLead com brainType 'sdr' e fup_config enabled=true → INSERT inclui fupEnabled=true nos values", async () => {
    // fup_config retorna enabled=true para brainType 'sdr'
    mockLimit4.mockImplementation(async () => [{ brainType: "sdr", enabled: true }]);
    // INSERT retorna lead com fupEnabled=true (implementação futura setar esse valor)
    mockReturning.mockImplementation(async () => [
      {
        id: "uuid-new",
        uniqueId: "lead-new",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        fupEnabled: true,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service4.upsertLead("5511999990001", "lead-new", "João", "sdr");

    // Implementação DEVE consultar fup_config via SELECT antes do INSERT
    expect(mockSelect4).toHaveBeenCalledTimes(1);
    // Implementação DEVE passar fupEnabled: true nos values do INSERT
    expect(mockValues).toHaveBeenCalledTimes(1);
    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg).toHaveProperty("fupEnabled", true);
  });

  it("Test 2 (INSERT + config disabled): upsertLead com brainType 'sdr' e fup_config enabled=false → INSERT inclui fupEnabled=false nos values", async () => {
    // fup_config retorna enabled=false para brainType 'sdr'
    mockLimit4.mockImplementation(async () => [{ brainType: "sdr", enabled: false }]);
    mockReturning.mockImplementation(async () => [
      {
        id: "uuid-new",
        uniqueId: "lead-new",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service4.upsertLead("5511999990001", "lead-new", "João", "sdr");

    // Implementação DEVE consultar fup_config via SELECT antes do INSERT
    expect(mockSelect4).toHaveBeenCalledTimes(1);
    // Implementação DEVE passar fupEnabled: false explicitamente (config existe mas disabled)
    expect(mockValues).toHaveBeenCalledTimes(1);
    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg).toHaveProperty("fupEnabled", false);
  });

  it("Test 3 (INSERT sem brainType): upsertLead sem brainType NÃO consulta fup_config e usa default fupEnabled=false", async () => {
    // Sem brainType — SELECT em fup_config NÃO deve ser chamado
    mockReturning.mockImplementation(async () => [
      {
        id: "uuid-new",
        uniqueId: "lead-new",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        fupEnabled: false,
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Chamar sem brainType (4º parâmetro ausente)
    await service4.upsertLead("5511999990001", "lead-new", "João");

    // D-04: SELECT em fup_config NÃO é chamado quando brainType não informado
    expect(mockSelect4).not.toHaveBeenCalled();
    // Implementação DEVE passar fupEnabled: false (default) nos values
    expect(mockValues).toHaveBeenCalledTimes(1);
    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg).toHaveProperty("fupEnabled", false);
  });

  it("Test 4 (UPDATE preserva fup_enabled): onConflictDoUpdate.set NÃO inclui fupEnabled (D-03)", async () => {
    // Lead existente com fupEnabled=false — UPDATE não deve tocar fupEnabled
    mockLimit4.mockImplementation(async () => [{ brainType: "sdr", enabled: true }]);
    mockReturning.mockImplementation(async () => [
      {
        id: "uuid-existing",
        uniqueId: "lead-existing",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        fupEnabled: false,  // preservado — não sobrescrito pelo UPDATE
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await service4.upsertLead("5511999990001", "lead-existing", "João", "sdr");

    // D-03: o set do onConflictDoUpdate NÃO deve conter fupEnabled
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.set).not.toHaveProperty("fupEnabled");
  });

  it("Test 5 (INSERT + config inexistente): upsertLead com brainType desconhecido → fupEnabled=false nos values, sem exceção (D-04)", async () => {
    // fup_config não encontrado — retorna array vazio (comportamento silencioso)
    mockLimit4.mockImplementation(async () => []);
    mockReturning.mockImplementation(async () => [
      {
        id: "uuid-new",
        uniqueId: "lead-new",
        numero: "5511999990001",
        nome: "João",
        iaAtivada: true,
        fullpp: null,
        fupEnabled: false,  // default silencioso — sem warning, sem exceção
        fupStep: 0,
        fupNextAt: null,
        lastMessageAt: null,
        fupFailureCount: 0,
        idDeal: null,
        idContato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // D-04: comportamento silencioso — sem exceção quando config não existe
    let thrownError: unknown = null;
    try {
      await service4.upsertLead("5511999990001", "lead-new", "João", "unknown-brain");
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeNull();
    // Implementação DEVE consultar fup_config via SELECT (mesmo que retorne vazio)
    expect(mockSelect4).toHaveBeenCalledTimes(1);
    // Implementação DEVE passar fupEnabled: false (fallback silencioso) nos values
    expect(mockValues).toHaveBeenCalledTimes(1);
    const valuesArg = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(valuesArg).toHaveProperty("fupEnabled", false);
  });
});
