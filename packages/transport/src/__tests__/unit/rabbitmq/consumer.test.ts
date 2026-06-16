// TRP-03, TRP-04, TRP-05: RabbitMQTransport — consumer com ack manual, retry e DLQ
// TOK-06: captura resultado de runner.run() e loga tokenUsage com pino.info
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { ConfigurationError } from "@brain-pkg/shared";

// Mock @brain-pkg/observability ANTES do import do consumer — para capturar logger.info calls
const mockLoggerInfo = mock((_obj: unknown, _msg?: string) => {});
const mockLoggerError = mock((_obj: unknown, _msg?: string) => {});
const mockLoggerWarn = mock((_obj: unknown, _msg?: string) => {});
const mockLoggerDebug = mock((_obj: unknown, _msg?: string) => {});
const mockLogger = {
  info: mockLoggerInfo,
  error: mockLoggerError,
  warn: mockLoggerWarn,
  debug: mockLoggerDebug,
};

mock.module("@brain-pkg/observability", () => ({
  createLogger: mock(() => mockLogger),
}));

// Mock rabbitmq-client ANTES do import do consumer
const mockHandlerRef: { fn: ((msg: unknown) => Promise<number>) | null } = { fn: null };

const mockSubClose = mock(async () => {});
const mockSubOn = mock((_event: string, _fn: unknown) => {});
const mockSub = { close: mockSubClose, on: mockSubOn };

const mockPubSend = mock(async (_queue: string, _body: unknown) => {});
const mockPubClose = mock(async () => {});
const mockPub = { send: mockPubSend, close: mockPubClose };

const mockRabbitOn = mock((_event: string, _fn: unknown) => {});
const mockRabbitClose = mock(async () => {});
const mockCreateConsumer = mock((_opts: unknown, fn: unknown) => {
  // Guardar o handler para chamá-lo nos testes
  mockHandlerRef.fn = fn as (msg: unknown) => Promise<number>;
  return mockSub;
});
const mockCreatePublisher = mock((_opts?: unknown) => mockPub);

const MockConnection = mock(function (_url: string) {
  return {
    on: mockRabbitOn,
    close: mockRabbitClose,
    createConsumer: mockCreateConsumer,
    createPublisher: mockCreatePublisher,
  };
});

mock.module("rabbitmq-client", () => ({
  Connection: MockConnection,
  ConsumerStatus: { ACK: 0, REQUEUE: 1, DROP: 2 },
}));

import { RabbitMQTransport } from "../../../rabbitmq/consumer.js";

// TOK-06: wrapper shape — runner agora retorna { brainOutput, tokenUsage }
const mockRunner = {
  run: mock(async (_event: unknown) => ({
    brainOutput: { fullResponse: "ok", responseMode: "text" as const },
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  })),
};

function makeMsg(body: unknown, deliveryTag = BigInt(1)) {
  return { body, deliveryTag, redelivered: false };
}

const validBody = {
  Name: "Joao",
  Message: "Ola",
  Numero: "5511999990001",
  IDLead: "lead-abc",
};

describe("RabbitMQTransport (TRP-03, TRP-04, TRP-05)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    MockConnection.mockClear();
    mockRabbitOn.mockClear();
    mockCreateConsumer.mockClear();
    mockCreatePublisher.mockClear();
    mockPubSend.mockClear();
    mockSubClose.mockClear();
    mockPubClose.mockClear();
    mockRabbitClose.mockClear();
    (mockRunner.run as ReturnType<typeof mock>).mockClear();
    // TOK-06: wrapper shape para reset padrão entre testes
    (mockRunner.run as ReturnType<typeof mock>).mockResolvedValue({
      brainOutput: { fullResponse: "ok", responseMode: "text" as const },
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
    mockHandlerRef.fn = null;

    // Ambiente padrao valido
    process.env.RABBITMQ_URL = "amqp://guest:guest@localhost:5672";
    process.env.RABBITMQ_QUEUE = "brain-events";
    process.env.RABBITMQ_DLQ = "brain-dlq";
    process.env.RABBITMQ_RETRY_DELAY_MS = "0"; // sem delay nos testes
  });

  afterEach(() => {
    // Restaurar env
    for (const key of ["RABBITMQ_URL", "RABBITMQ_QUEUE", "RABBITMQ_DLQ", "RABBITMQ_RETRY_DELAY_MS"]) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  // TRP-04: ENVs obrigatorias
  it("start() lanca ConfigurationError quando RABBITMQ_URL ausente (TRP-04)", async () => {
    delete process.env.RABBITMQ_URL;
    const transport = new RabbitMQTransport(mockRunner);
    await expect(transport.start()).rejects.toThrow(ConfigurationError);
  });

  it("start() lanca ConfigurationError quando RABBITMQ_QUEUE ausente (TRP-04)", async () => {
    delete process.env.RABBITMQ_QUEUE;
    const transport = new RabbitMQTransport(mockRunner);
    await expect(transport.start()).rejects.toThrow(ConfigurationError);
  });

  it("start() lanca ConfigurationError quando RABBITMQ_DLQ ausente (TRP-04)", async () => {
    delete process.env.RABBITMQ_DLQ;
    const transport = new RabbitMQTransport(mockRunner);
    await expect(transport.start()).rejects.toThrow(ConfigurationError);
  });

  // TRP-03: processamento de mensagem valida
  it("mensagem valida chama runner.run() e retorna ACK (TRP-03)", async () => {
    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    // Simular chegada de mensagem chamando o handler diretamente
    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();
    const status = await handler!(makeMsg(validBody));

    expect(mockRunner.run).toHaveBeenCalledTimes(1);
    expect(mockRunner.run).toHaveBeenCalledWith(validBody);
    expect(status).toBe(0); // ConsumerStatus.ACK
  });

  // TRP-03: payload invalido -> DLQ imediato, sem runner
  it("payload invalido (sem IDLead) publica na DLQ e ACK sem chamar runner (TRP-03)", async () => {
    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    const invalidBody = { Name: "Joao", Message: "Ola", Numero: "5511999990001" }; // IDLead ausente
    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();
    const status = await handler!(makeMsg(invalidBody));

    expect(mockRunner.run).not.toHaveBeenCalled();
    expect(mockPubSend).toHaveBeenCalledTimes(1);
    const [dlqName] = mockPubSend.mock.calls[0] as [string, unknown];
    expect(dlqName).toBe("brain-dlq");
    expect(status).toBe(0); // ConsumerStatus.ACK (mensagem invalida foi ackada + DLQ)
  });

  // TRP-05: apos 3 falhas, publicar na DLQ e nao chamar runner uma 4a vez
  it("apos 3 falhas runner.run() publica na DLQ e nao chama run() uma 4a vez (TRP-05)", async () => {
    (mockRunner.run as ReturnType<typeof mock>).mockRejectedValue(new Error("processing failed"));

    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();

    // 3 tentativas com a mesma mensagem (mesma chave IDLead:Numero)
    const msg = makeMsg(validBody);
    await handler!(msg); // attempt 1 — falha, REQUEUE
    await handler!(msg); // attempt 2 — falha, REQUEUE
    const statusFinal = await handler!(msg); // attempt 3 — falha, -> DLQ + ACK

    expect(mockRunner.run).toHaveBeenCalledTimes(3);
    expect(mockPubSend).toHaveBeenCalledTimes(1); // publicou na DLQ uma vez
    const [dlqName] = mockPubSend.mock.calls[0] as [string, unknown];
    expect(dlqName).toBe("brain-dlq");
    expect(statusFinal).toBe(0); // ConsumerStatus.ACK (mensagem removida da fila principal)
  });

  it("stop() fecha sub, pub e connection", async () => {
    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();
    await transport.stop();

    expect(mockSubClose).toHaveBeenCalled();
    expect(mockPubClose).toHaveBeenCalled();
    expect(mockRabbitClose).toHaveBeenCalled();
  });

  // --- Testes TOK-06: log de tokenUsage ---

  it("TOK-06a: loga tokenUsage com logger.info quando run() retorna wrapper (D-10)", async () => {
    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();
    await handler!(makeMsg(validBody));

    // Verificar que logger.info foi chamado com { tokenUsage } e mensagem "turn token usage"
    const infoCallsWithTokenUsage = mockLoggerInfo.mock.calls.filter(
      (args) => {
        const [obj, msg] = args as [unknown, string?];
        return msg === "turn token usage" && typeof obj === "object" && obj !== null && "tokenUsage" in (obj as object);
      }
    );
    expect(infoCallsWithTokenUsage.length).toBeGreaterThan(0);
    const [logObj] = infoCallsWithTokenUsage[0] as [{ tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } }];
    expect(logObj.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it("TOK-06b: não loga tokenUsage quando run() retorna null (ia_ativada=false)", async () => {
    (mockRunner.run as ReturnType<typeof mock>).mockResolvedValueOnce(null);

    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();
    await handler!(makeMsg(validBody));

    // Nenhuma chamada de logger.info com "turn token usage" deve ter ocorrido
    const infoCallsWithTokenUsage = mockLoggerInfo.mock.calls.filter(
      (args) => {
        const [, msg] = args as [unknown, string?];
        return msg === "turn token usage";
      }
    );
    expect(infoCallsWithTokenUsage.length).toBe(0);
  });

  it("TOK-06d: não publica em fila quando runner.run() retorna wrapper (D-10 — sem publicação)", async () => {
    const transport = new RabbitMQTransport(mockRunner);
    await transport.start();

    const handler = mockHandlerRef.fn;
    expect(handler).not.toBeNull();
    await handler!(makeMsg(validBody));

    // pub.send() NÃO deve ser chamado no caminho de sucesso (apenas DLQ recebe pub.send)
    expect(mockPubSend).not.toHaveBeenCalled();
  });
});
