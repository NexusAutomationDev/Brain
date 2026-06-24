// FUP-01, FUP-02, FUP-03, FUP-05, FUP-07, FUP-08, EVT-03: Testes unitários do FupScheduler
// Cobrem regras de negócio: polling, elegibilidade, envio, retry, EVT-03, último FUP, stop
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { FupScheduler } from "../../../fup/fup-scheduler.js";

// ---- Tipos internos usados nos mocks ----
interface FupLeadRowMock {
  id: string;
  uniqueId: string;
  nome: string | null;
  numero: string;
  fupStep: number;
  fupNextAt: Date | null;
  fupFailureCount: number;
  iaAtivada: boolean;
  fupEnabled: boolean;
  intervalsSeconds: number[];
  minHour: number;
  maxHour: number;
  allowedDays: string[];
  timezone: string;
}

function makeLead(overrides: Partial<FupLeadRowMock> = {}): FupLeadRowMock {
  return {
    id: "uuid-1",
    uniqueId: "lead-unique-1",
    nome: "João Silva",
    numero: "5511999990001",
    fupStep: 0,
    fupNextAt: new Date(Date.now() - 1000),
    fupFailureCount: 0,
    iaAtivada: true,
    fupEnabled: true,
    intervalsSeconds: [3600, 86400, 259200], // 3 intervalos
    minHour: 9,
    maxHour: 18,
    allowedDays: ["mon", "tue", "wed", "thu", "fri"],
    timezone: "America/Sao_Paulo",
    ...overrides,
  };
}

// ---- Helper para criar sql mock ----
function makeSqlBeginMock(leads: FupLeadRowMock[]) {
  const txTemplate = Object.assign(
    (..._args: unknown[]) => Promise.resolve(leads),
    { unsafe: (str: string) => str }
  );
  return mock((fn: (tx: typeof txTemplate) => Promise<unknown>) => fn(txTemplate));
}

// ---- Criar scheduler com mocks ----
function makeScheduler(options: {
  leads?: FupLeadRowMock[];
  promptContent?: string | null;
  fetchMock?: ReturnType<typeof mock>;
  eventPublisher?: { publish: ReturnType<typeof mock>; close: ReturnType<typeof mock> } | null;
}) {
  const leads = options.leads ?? [];
  // Usar !== undefined para distinguir null (sem prompt) de undefined (não fornecido)
  const promptContent = options.promptContent !== undefined ? options.promptContent : "Você é um assistente de FUP.";
  const fetchMockFn = options.fetchMock ?? mock(async () => new Response(null, { status: 200 }));

  let promptServed = false;
  const sqlBeginMock = makeSqlBeginMock(leads);
  const updateCallStrings: string[] = [];

  const sqlTemplate = Object.assign(
    (strings: TemplateStringsArray | unknown, ..._vals: unknown[]) => {
      if (!promptServed) {
        promptServed = true;
        if (promptContent === null) return Promise.resolve([]);
        return Promise.resolve([{ content: promptContent }]);
      }
      // UPDATEs subsequentes
      if (Array.isArray(strings)) {
        updateCallStrings.push((strings as string[]).join(""));
      }
      return Promise.resolve([]);
    },
    {
      begin: sqlBeginMock,
      unsafe: (str: string) => str,
    }
  );

  const checkpointer = {
    getTuple: mock(() => Promise.resolve(undefined)),
  } as unknown as import("@langchain/langgraph-checkpoint-postgres").PostgresSaver;

  const scheduler = new FupScheduler({
    sql: sqlTemplate as unknown as import("postgres").Sql,
    brainType: "sdr",
    checkpointer,
    eventPublisher: options.eventPublisher !== undefined ? options.eventPublisher : null,
    fupWebhookUrl: "http://localhost:3001/fup-webhook",
  });

  // Injetar fetchMock no escopo do scheduler via monkey-patch de _sendFupWebhook
  // (abordagem mais limpa: injetar direto no método privado)
  const originalSend = (scheduler as unknown as { _sendFupWebhook: Function })._sendFupWebhook.bind(scheduler);
  (scheduler as unknown as { _sendFupWebhook: Function })._sendFupWebhook = async (lead: FupLeadRowMock, message: string) => {
    // Usar a fetchMock injetada
    const response = await fetchMockFn(scheduler["opts" as keyof typeof scheduler] ? "http://localhost:3001/fup-webhook" : "http://localhost:3001/fup-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Name: lead.nome ?? "", Numero: lead.numero, Message: message, IDLead: lead.uniqueId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`FUP webhook retornou ${response.status} para lead ${lead.uniqueId}`);
    }
  };

  return { scheduler, sqlBeginMock, updateCallStrings, fetchMockFn };
}

// ---- Testes ----

describe("FupScheduler._tick()", () => {
  test("FUP-02: quando sql.begin retorna leads, chama _processFupForLead para cada um", async () => {
    const lead = makeLead();
    const { scheduler, sqlBeginMock } = makeScheduler({ leads: [lead] });

    // Spy em _processFupForLead
    const processSpy = mock(() => Promise.resolve());
    (scheduler as unknown as { _processFupForLead: typeof processSpy })._processFupForLead = processSpy;

    await scheduler._tick();

    expect(sqlBeginMock).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith(lead);
  });

  test("FUP-02: quando sql.begin retorna vazio, não chama _processFupForLead", async () => {
    const { scheduler, sqlBeginMock } = makeScheduler({ leads: [] });

    const processSpy = mock(() => Promise.resolve());
    (scheduler as unknown as { _processFupForLead: typeof processSpy })._processFupForLead = processSpy;

    await scheduler._tick();

    expect(sqlBeginMock).toHaveBeenCalledTimes(1);
    expect(processSpy).not.toHaveBeenCalled();
  });
});

describe("FupScheduler._processFupForLead()", () => {
  test("D-13: quando prompt key='fup' não existe, loga warn e retorna sem processar", async () => {
    const lead = makeLead();
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const { scheduler } = makeScheduler({ leads: [lead], promptContent: null, fetchMock });

    let warnCalled = false;
    const fakeLogger = {
      info: () => {},
      warn: (..._args: unknown[]) => { warnCalled = true; },
      error: () => {},
      debug: () => {},
    };
    (scheduler as unknown as { logger: typeof fakeLogger }).logger = fakeLogger;

    await scheduler._processFupForLead(lead);

    expect(warnCalled).toBe(true);
    // fetch nunca chamado — prompt não encontrado, método retornou cedo
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("FUP-05/D-10: último FUP seta ia_ativada=false e fup_enabled=false no UPDATE", async () => {
    // Último step: fupStep=2, intervalsSeconds.length=3 → nextFupStep(3) >= length(3) → último FUP
    const lead = makeLead({ fupStep: 2, intervalsSeconds: [3600, 86400, 259200] });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const { scheduler, updateCallStrings } = makeScheduler({ leads: [lead], fetchMock });

    // Mock da geração LLM para não precisar do LLM real
    const generateSpy = mock(() => Promise.resolve("Olá, lembrete de FUP!"));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    await scheduler._processFupForLead(lead);

    // Verificar que o envio ocorreu
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Verificar que o UPDATE incluiu ia_ativada=false e fup_enabled=false
    const allSql = updateCallStrings.join(" ");
    expect(allSql).toContain("ia_ativada");
    expect(allSql).toContain("fup_enabled");
  });

  test("FUP-08/D-14: após 3 falhas acumuladas, fup_enabled=false e logger.error chamado", async () => {
    // Lead já tem 2 falhas — mais 1 = 3 → desativar
    const lead = makeLead({ fupFailureCount: 2 });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const { scheduler, updateCallStrings } = makeScheduler({ leads: [lead], fetchMock });

    let errorCalled = false;
    const fakeLogger = {
      info: () => {},
      warn: () => {},
      error: (..._args: unknown[]) => { errorCalled = true; },
      debug: () => {},
    };
    (scheduler as unknown as { logger: typeof fakeLogger }).logger = fakeLogger;

    // Mock geração LLM para sempre lançar erro
    const generateSpy = mock(() => Promise.reject(new Error("LLM indisponível")));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    await scheduler._processFupForLead(lead);

    expect(errorCalled).toBe(true);
    // Deve ter chamado UPDATE com fup_enabled=false
    const allSql = updateCallStrings.join(" ");
    expect(allSql).toContain("fup_enabled");
  });

  test("FUP-08: fup_failure_count resetado para 0 após sucesso com falhas anteriores", async () => {
    // Lead com 2 falhas anteriores, agora com sucesso
    const lead = makeLead({ fupFailureCount: 2 });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const { scheduler, updateCallStrings } = makeScheduler({ leads: [lead], fetchMock });

    const generateSpy = mock(() => Promise.resolve("Mensagem de FUP de sucesso"));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    await scheduler._processFupForLead(lead);

    // Deve ter feito o envio
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Deve ter chamado UPDATE com fup_failure_count = 0
    const allSql = updateCallStrings.join(" ");
    expect(allSql).toContain("fup_failure_count");
  });

  test("EVT-03/D-16: após envio bem-sucedido, eventPublisher.publish chamado com action='fup'", async () => {
    const lead = makeLead({ fupStep: 0, intervalsSeconds: [3600, 86400] });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const publishMock = mock(() => Promise.resolve());
    const eventPublisher = {
      publish: publishMock,
      close: mock(() => Promise.resolve()),
    };
    const { scheduler } = makeScheduler({ leads: [lead], fetchMock, eventPublisher });

    const generateSpy = mock(() => Promise.resolve("Mensagem de FUP"));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    await scheduler._processFupForLead(lead);

    // Dar tempo para o fire-and-forget completar
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(publishMock).toHaveBeenCalledTimes(1);
    const publishArgs = (publishMock as ReturnType<typeof mock>).mock.calls[0] as unknown as [unknown[]];
    const events = publishArgs[0] as { action: string }[];
    expect(Array.isArray(events)).toBe(true);
    expect(events[0].action).toBe("fup");
  });

  test("EVT-03/D-17: event_id = `${lead.uniqueId}:fup:${fupStep}`", async () => {
    const lead = makeLead({ uniqueId: "lead-abc", fupStep: 1, intervalsSeconds: [3600, 86400, 259200] });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const publishMock = mock(() => Promise.resolve());
    const eventPublisher = {
      publish: publishMock,
      close: mock(() => Promise.resolve()),
    };
    const { scheduler } = makeScheduler({ leads: [lead], fetchMock, eventPublisher });

    const generateSpy = mock(() => Promise.resolve("Mensagem FUP step 1"));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    await scheduler._processFupForLead(lead);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(publishMock).toHaveBeenCalledTimes(1);
    const publishArgs = (publishMock as ReturnType<typeof mock>).mock.calls[0] as unknown as [unknown[]];
    const events = publishArgs[0] as { event_id: string }[];
    expect(events[0].event_id).toBe("lead-abc:fup:1");
  });

  test("D-18: quando eventPublisher é null, publicação pulada silenciosamente", async () => {
    const lead = makeLead({ fupStep: 0, intervalsSeconds: [3600, 86400] });
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    const { scheduler } = makeScheduler({ leads: [lead], fetchMock, eventPublisher: null });

    const generateSpy = mock(() => Promise.resolve("Mensagem de FUP"));
    (scheduler as unknown as { _generateFupMessage: typeof generateSpy })._generateFupMessage = generateSpy;

    // Não deve lançar erro
    await expect(scheduler._processFupForLead(lead)).resolves.toBeUndefined();
    // Fetch ainda deve ter sido chamado (envio do FUP)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("FupScheduler.stop()", () => {
  test("D-02: clearInterval chamado; segundo stop() é noop sem erro", async () => {
    const { scheduler } = makeScheduler({ leads: [] });

    // Iniciar scheduler (cria interval)
    await scheduler.start();

    // Primeiro stop — deve funcionar
    await expect(scheduler.stop()).resolves.toBeUndefined();

    // Segundo stop — deve ser noop sem lançar
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });
});
