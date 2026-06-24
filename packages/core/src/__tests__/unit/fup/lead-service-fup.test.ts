// FUP-06, D-19: Testes unitários de LeadService.resetFup()
// Verifica que resetFup seta fupNextAt=null e fupStep=0 sem tocar fupEnabled
import { describe, test, expect, mock } from "bun:test";
import { LeadService } from "../../../leads/lead-service.js";

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
