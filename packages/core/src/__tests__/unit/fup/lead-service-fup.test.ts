// FUP-06, D-19: Testes unitários de LeadService.resetFup()
// Phase 26, FUP-02: Testes de upsertLead() — fupNextAt calculado no INSERT quando fupEnabled=true
// Verifica que resetFup seta fupNextAt=null e fupStep=0 sem tocar fupEnabled
import { describe, test, expect, mock } from "bun:test";
import { LeadService } from "../../../leads/lead-service.js";
import type { Lead } from "../../../leads/lead-service.js";

// ---- Mock do chain do Drizzle: db.update().set().where() ----
function makeDbMock() {
  const whereMock = mock(() => Promise.resolve([]));
  const setMock = mock(() => ({ where: whereMock }));
  const updateMock = mock(() => ({ set: setMock }));

  // Capturar argumentos passados para set()
  const getSetArgs = () => (setMock.mock.calls[0]?.[0] as Record<string, unknown>) ?? null;

  return { updateMock, setMock, whereMock, getSetArgs };
}

// Injetar mock do db no LeadService (acesso via campo privado)
function makeLeadServiceWithMock() {
  // Criar sql fake (não usado diretamente — db é substituído depois)
  const fakeSql = {} as import("postgres").Sql;
  const service = new LeadService(fakeSql);

  const { updateMock, setMock, whereMock, getSetArgs } = makeDbMock();

  // Substituir instância privada do db pelo mock
  (service as unknown as { db: { update: typeof updateMock } }).db = {
    update: updateMock,
  };

  return { service, updateMock, setMock, whereMock, getSetArgs };
}

describe("LeadService.resetFup()", () => {
  test("FUP-06/D-19: chama update(leads).set({ fupNextAt: null, fupStep: 0 }).where(eq(uniqueId))", async () => {
    const { service, updateMock, setMock, whereMock } = makeLeadServiceWithMock();

    await service.resetFup("lead-123");

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  test("FUP-06/D-19: set() recebe { fupNextAt: null, fupStep: 0 } — sem fupEnabled", async () => {
    const { service, getSetArgs } = makeLeadServiceWithMock();

    await service.resetFup("lead-abc");

    const setPayload = getSetArgs();
    expect(setPayload).not.toBeNull();
    // fupNextAt deve ser null
    expect(setPayload!.fupNextAt).toBeNull();
    // fupStep deve ser 0
    expect(setPayload!.fupStep).toBe(0);
    // fupEnabled NÃO deve estar presente — D-19: fup_enabled permanece true após reset
    expect("fupEnabled" in setPayload!).toBe(false);
    // iaAtivada NÃO deve estar presente
    expect("iaAtivada" in setPayload!).toBe(false);
    // WR-02: updatedAt deve estar presente e ser Date
    expect(setPayload!.updatedAt).toBeInstanceOf(Date);
  });

  test("FUP-06: resetFup com uniqueId inexistente não lança erro (update sem rows é noop no Drizzle)", async () => {
    const { service } = makeLeadServiceWithMock();

    // Não deve lançar mesmo com uniqueId que não existe no banco
    await expect(service.resetFup("uniqueId-que-nao-existe")).resolves.toBeUndefined();
  });
});

// ---- Phase 26, FUP-02: Testes de upsertLead() — fupNextAt no INSERT ----

type FupConfigRow = {
  enabled: boolean;
  intervalsSeconds: number[];
  minHour: number;
  maxHour: number;
  allowedDays: string[];
  timezone: string;
};

type LeadRow = {
  numero: string;
  uniqueId: string;
  fupEnabled: boolean;
  fupNextAt: Date | null;
  [key: string]: unknown;
};

/**
 * Cria mock do db para upsertLead() que simula dois select() chains:
 * - Primeira chamada: SELECT existing lead (retorna null = INSERT path, ou lead = UPDATE path)
 * - Segunda chamada: SELECT fup_config (retorna config ou null)
 * E também simula insert().values().onConflictDoUpdate().returning()
 */
function makeUpsertDbMock(opts: {
  existing: LeadRow | null;
  fupConfigRow: FupConfigRow | null;
  insertResult: LeadRow;
}) {
  // Chain: db.insert().values().onConflictDoUpdate().returning()
  const insertReturningMock = mock(() => Promise.resolve([opts.insertResult]));
  const onConflictMock = mock(() => ({ returning: insertReturningMock }));
  const insertValuesMock = mock(() => ({ onConflictDoUpdate: onConflictMock }));
  const insertMock = mock(() => ({ values: insertValuesMock }));

  // Chain: db.select().from().where().limit() — dois selects com contador
  let selectCallCount = 0;
  const limitMock = mock(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // Primeira chamada: SELECT existing lead
      return Promise.resolve(opts.existing ? [opts.existing] : []);
    }
    // Segunda chamada: SELECT fup_config
    return Promise.resolve(opts.fupConfigRow ? [opts.fupConfigRow] : []);
  });
  const whereMock = mock(() => ({ limit: limitMock }));
  const fromMock = mock(() => ({ where: whereMock }));
  const selectMock = mock(() => ({ from: fromMock }));

  return { selectMock, insertMock, insertValuesMock, onConflictMock, insertReturningMock };
}

function makeLeadServiceForUpsert(opts: {
  existing: LeadRow | null;
  fupConfigRow: FupConfigRow | null;
  insertResult: LeadRow;
}) {
  const fakeSql = {} as import("postgres").Sql;
  const service = new LeadService(fakeSql);

  const mocks = makeUpsertDbMock(opts);

  (service as unknown as { db: unknown }).db = {
    select: mocks.selectMock,
    insert: mocks.insertMock,
  };

  return { service, ...mocks };
}

const baseFupConfig: FupConfigRow = {
  enabled: true,
  intervalsSeconds: [3600],
  minHour: 8,
  maxHour: 18,
  allowedDays: ["mon", "tue", "wed", "thu", "fri"],
  timezone: "America/Sao_Paulo",
};

const baseInsertResult: LeadRow = {
  numero: "5511999990001",
  uniqueId: "lead-upsert-01",
  fupEnabled: true,
  fupNextAt: new Date(),
};

describe("LeadService.upsertLead() — fupNextAt no INSERT", () => {
  test("FUP-02/Phase26: INSERT com fupEnabled=true persiste fupNextAt como Date (não null)", async () => {
    const { service, insertValuesMock } = makeLeadServiceForUpsert({
      existing: null,           // INSERT path
      fupConfigRow: baseFupConfig,
      insertResult: baseInsertResult,
    });

    await service.upsertLead("5511999990001", "lead-upsert-01", "Teste", "sdr");

    // values() deve ter sido chamado com fupNextAt como Date
    const valuesArg = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg).toBeDefined();
    expect(valuesArg.fupNextAt).toBeInstanceOf(Date);
    expect(valuesArg.fupNextAt).not.toBeNull();
  });

  test("FUP-02/Phase26: INSERT sem fup_config mantém fupNextAt=null", async () => {
    const { service, insertValuesMock } = makeLeadServiceForUpsert({
      existing: null,           // INSERT path
      fupConfigRow: null,       // sem config
      insertResult: { ...baseInsertResult, fupEnabled: false, fupNextAt: null },
    });

    await service.upsertLead("5511999990002", "lead-upsert-02", "Teste2", "sdr");

    const valuesArg = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg).toBeDefined();
    expect(valuesArg.fupNextAt).toBeNull();
  });

  test("FUP-02/Phase26: INSERT com intervals_seconds=[] mantém fupNextAt=null (guard Pitfall 2)", async () => {
    const { service, insertValuesMock } = makeLeadServiceForUpsert({
      existing: null,           // INSERT path
      fupConfigRow: { ...baseFupConfig, intervalsSeconds: [] }, // array vazio
      insertResult: { ...baseInsertResult, fupEnabled: false, fupNextAt: null },
    });

    await service.upsertLead("5511999990003", "lead-upsert-03", "Teste3", "sdr");

    const valuesArg = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg).toBeDefined();
    // Guard Pitfall 2: intervalsSeconds vazio → fupNextAt deve ser null
    expect(valuesArg.fupNextAt).toBeNull();
  });

  test("FUP-02/Phase26: UPDATE (lead existente) não altera fupNextAt — campo ausente do set{}", async () => {
    const existingLead: LeadRow = {
      numero: "5511999990004",
      uniqueId: "lead-upsert-04",
      fupEnabled: true,
      fupNextAt: new Date("2026-06-25T10:00:00Z"),
    };

    const { service, insertValuesMock } = makeLeadServiceForUpsert({
      existing: existingLead,   // UPDATE path — lead já existe
      fupConfigRow: baseFupConfig,
      insertResult: existingLead,
    });

    await service.upsertLead("5511999990004", "lead-upsert-04", "Teste4", "sdr");

    // No UPDATE path, a fup_config NÃO deve ser consultada (isInsert=false)
    // O INSERT ainda é chamado (INSERT ON CONFLICT DO UPDATE), mas values()
    // deve conter fupEnabled=false e fupNextAt=null (valores padrão, não consultados)
    const valuesArg = insertValuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg).toBeDefined();
    // No UPDATE path, fupEnabled default é false e fupNextAt default é null
    expect(valuesArg.fupEnabled).toBe(false);
    expect(valuesArg.fupNextAt).toBeNull();
  });
});
