// EVT-01, EVT-02, EVT-04: EventPublisher unit tests
// TDD RED phase — tests written before implementation

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// --- Mocks setup (before imports that use them) ---

const mockSend = mock(async (_queue: string, _body: unknown) => {});
const mockPubClose = mock(async () => {});
const mockRabbitClose = mock(async () => {});

const mockCreatePublisher = mock(() => ({
  send: mockSend,
  close: mockPubClose,
}));

const MockConnection = mock(function (_url: string) {
  return {
    createPublisher: mockCreatePublisher,
    close: mockRabbitClose,
  };
});

mock.module("rabbitmq-client", () => ({
  Connection: MockConnection,
}));

const mockWarn = mock((_obj: unknown, _msg?: string) => {});

mock.module("@brain-pkg/observability", () => ({
  createLogger: mock(() => ({
    info: mock(() => {}),
    warn: mockWarn,
    error: mock(() => {}),
    debug: mock(() => {}),
  })),
}));

// ConfigurationError mock — deve se comportar como a classe real
class ConfigurationError extends Error {
  constructor(message: string, _context?: Record<string, unknown>) {
    super(message);
    this.name = "ConfigurationError";
  }
}

mock.module("@brain-pkg/shared", () => ({
  ConfigurationError,
}));

// Import APÓS os mocks
const { EventPublisher, NoopEventPublisher } = await import("../../event-publisher.js");

// --- Helper: evento de teste ---
function makeEvent(overrides: Partial<{
  event_id: string;
  action: string;
  lead: { id: string; nome: string | null; numero: string };
  result: string;
  timestamp: string;
}> = {}) {
  return {
    event_id: "lead-abc:call-xyz",
    action: "qualify_lead",
    lead: { id: "lead-abc", nome: "João", numero: "11999999999" },
    result: '{"qualificado":true}',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventPublisher", () => {
  beforeEach(() => {
    // Limpar ENVs entre testes
    delete process.env.TOOL_EVENTS_URL;
    delete process.env.TOOL_EVENTS_QUEUE;
    delete process.env.RABBITMQ_URL;

    // Reset mocks
    mockSend.mockReset();
    mockPubClose.mockReset();
    mockRabbitClose.mockReset();
    mockCreatePublisher.mockReset();
    MockConnection.mockReset();
    mockWarn.mockReset();

    // Restaurar mockCreatePublisher para retornar publisher válido após reset
    mockCreatePublisher.mockImplementation(() => ({
      send: mockSend,
      close: mockPubClose,
    }));
    MockConnection.mockImplementation((_url: string) => ({
      createPublisher: mockCreatePublisher,
      close: mockRabbitClose,
    }));

    // Restaurar fetch global
    globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    delete process.env.TOOL_EVENTS_URL;
    delete process.env.TOOL_EVENTS_QUEUE;
    delete process.env.RABBITMQ_URL;
  });

  // -------------------------------------------------------------------
  // EVT-01 — Webhook mode
  // -------------------------------------------------------------------
  describe("modo webhook", () => {
    test("publish() chama fetch com POST, body JSON e Content-Type correto", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      const event = makeEvent();
      await publisher.publish([event]);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://example.com/events");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.parse(options.body as string)).toEqual(event);
    });

    test("publish() absorve erro de fetch silenciosamente", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

      const event = makeEvent();
      // Não deve lançar
      await expect(publisher.publish([event])).resolves.toBeUndefined();
    });

    test("publish() loga warn com eventId mas SEM PII quando fetch lança", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

      const event = makeEvent({ event_id: "thread-123:call-456" });
      await publisher.publish([event]);

      expect(mockWarn).toHaveBeenCalledTimes(1);
      const [logObj] = mockWarn.mock.calls[0] as [Record<string, unknown>, string];
      // Deve logar eventId
      expect(logObj.eventId).toBe("thread-123:call-456");
      // NÃO deve logar PII do lead
      expect(JSON.stringify(logObj)).not.toContain("João");
      expect(JSON.stringify(logObj)).not.toContain("11999999999");
      expect(JSON.stringify(logObj)).not.toContain("lead-abc");
    });

    test("publish([]) com array vazio não chama fetch", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      await publisher.publish([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // EVT-01 — RabbitMQ mode
  // -------------------------------------------------------------------
  describe("modo rabbitmq", () => {
    test("publish() chama pub.send() com queue e evento corretos", async () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      process.env.RABBITMQ_URL = "amqp://localhost";
      const publisher = new EventPublisher();
      await publisher.init();

      const event = makeEvent();
      await publisher.publish([event]);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [queue, body] = mockSend.mock.calls[0] as [string, unknown];
      expect(queue).toBe("tool-events");
      expect(body).toEqual(event);
    });

    test("TOOL_EVENTS_QUEUE sem RABBITMQ_URL lança ConfigurationError no construtor", () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      // RABBITMQ_URL ausente
      expect(() => new EventPublisher()).toThrow(ConfigurationError);
    });

    test("D-06: quando QUEUE e URL ambos presentes, usa RabbitMQ (não chama fetch)", async () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      process.env.RABBITMQ_URL = "amqp://localhost";
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      const event = makeEvent();
      await publisher.publish([event]);

      // RabbitMQ tem prioridade — fetch não deve ser chamado
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test("publish() absorve erro de pub.send() silenciosamente", async () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      process.env.RABBITMQ_URL = "amqp://localhost";
      const publisher = new EventPublisher();
      await publisher.init();

      mockSend.mockImplementation(async () => { throw new Error("AMQP connection lost"); });

      const event = makeEvent();
      // Não deve lançar
      await expect(publisher.publish([event])).resolves.toBeUndefined();
    });

    test("publish([]) com array vazio não chama pub.send()", async () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      process.env.RABBITMQ_URL = "amqp://localhost";
      const publisher = new EventPublisher();
      await publisher.init();

      await publisher.publish([]);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // EVT-01 — Construtor sem nenhum ENV lança
  // -------------------------------------------------------------------
  describe("construtor sem ENVs", () => {
    test("sem TOOL_EVENTS_URL e sem TOOL_EVENTS_QUEUE: lança ConfigurationError", () => {
      expect(() => new EventPublisher()).toThrow(ConfigurationError);
    });
  });

  // -------------------------------------------------------------------
  // EVT-04 — event_id idempotente
  // -------------------------------------------------------------------
  describe("EVT-04 — event_id idempotente", () => {
    test("publish chamado 2x com mesmo event_id repassa o event_id sem modificar", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();

      const event = makeEvent({ event_id: "lead-abc:call-xyz" });
      await publisher.publish([event]);
      await publisher.publish([event]);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls as [string, RequestInit][];
      const body1 = JSON.parse(calls[0][1].body as string);
      const body2 = JSON.parse(calls[1][1].body as string);
      expect(body1.event_id).toBe("lead-abc:call-xyz");
      expect(body2.event_id).toBe("lead-abc:call-xyz");
    });
  });

  // -------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------
  describe("close()", () => {
    test("webhook mode: close() resolve sem lançar", async () => {
      process.env.TOOL_EVENTS_URL = "http://example.com/events";
      const publisher = new EventPublisher();
      await publisher.init();
      await expect(publisher.close()).resolves.toBeUndefined();
    });

    test("rabbitmq mode: close() fecha pub e rabbit", async () => {
      process.env.TOOL_EVENTS_QUEUE = "tool-events";
      process.env.RABBITMQ_URL = "amqp://localhost";
      const publisher = new EventPublisher();
      await publisher.init();
      await publisher.close();
      expect(mockPubClose).toHaveBeenCalledTimes(1);
      expect(mockRabbitClose).toHaveBeenCalledTimes(1);
    });
  });
});

// -------------------------------------------------------------------
// NoopEventPublisher
// -------------------------------------------------------------------
describe("NoopEventPublisher", () => {
  test("publish([]) resolve sem lançar", async () => {
    const noop = new NoopEventPublisher();
    await expect(noop.publish([])).resolves.toBeUndefined();
  });

  test("publish([event]) resolve sem lançar", async () => {
    const noop = new NoopEventPublisher();
    const event = {
      event_id: "x:y",
      action: "qualify_lead",
      lead: { id: "x", nome: null, numero: "11999" },
      result: "{}",
      timestamp: new Date().toISOString(),
    };
    await expect(noop.publish([event])).resolves.toBeUndefined();
  });

  test("close() resolve sem lançar", async () => {
    const noop = new NoopEventPublisher();
    await expect(noop.close()).resolves.toBeUndefined();
  });
});
