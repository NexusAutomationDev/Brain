// TRP-03, TRP-04, TRP-05: RabbitMQTransport — consumer RabbitMQ com ack manual, retry e DLQ
// D-07: biblioteca rabbitmq-client@^5.0.8 — zero deps, Bun-compatible, auto-reconnect built-in
// D-08: new RabbitMQTransport(runner) implementa ITransport
// D-14: NÃO declara filas — apenas conecta e consome (filas pré-configuradas por ops)
// D-15: prefetch=1 — uma mensagem por consumer por vez
// D-16: MAX_ATTEMPTS=3 — após 3 falhas, mensagem vai para DLQ
// D-19: DLQ via Publisher explícito + ACK da mensagem original (sem dependência de DLX broker)
// Pitfall RESEARCH.md: chave de retry = IDLead:Numero:channel (não deliveryTag — muda após REQUEUE)
// D-02/WR-03: sufixo de channel evita colisão de retry-count entre tipos de mensagem
// diferentes que compartilhem o mesmo par IDLead:Numero.

import { Connection, ConsumerStatus } from "rabbitmq-client";
import { ConfigurationError } from "@brain-pkg/shared";
import { createLogger } from "@brain-pkg/observability";
import { BrainEventSchema } from "../webhook/events.js";
import type { ITransport, TransportStatus } from "../interface.js";
import type { IBrainRunnerLike } from "../webhook/handler.js";

const MAX_ATTEMPTS = 3;

/**
 * TRP-03, TRP-05: RabbitMQTransport — consumer com ack manual, retry e DLQ.
 *
 * Configuração via ENVs (TRP-04):
 *   RABBITMQ_URL            — connection string (obrigatório)
 *   RABBITMQ_QUEUE          — fila de entrada (obrigatório)
 *   RABBITMQ_DLQ            — fila de saída para falhas permanentes (obrigatório)
 *   RABBITMQ_RETRY_DELAY_MS — backoff entre retries em ms (default: 1000)
 *
 * Segurança (T-07-08):
 *   - RABBITMQ_URL não é logado — apenas boolean de presença em ConfigurationError
 *   - BrainEventSchema.safeParse() valida payload antes de qualquer processamento (T-07-06 / ASVS V5)
 *
 * Anti-loop (T-07-07):
 *   - retryMap por chave IDLead:Numero — MAX_ATTEMPTS=3 garante fim após 3 falhas
 *   - Após MAX_ATTEMPTS: pub.send(DLQ) + ConsumerStatus.ACK (sem nack, sem requeue)
 */
export class RabbitMQTransport implements ITransport {
  private rabbit?: InstanceType<typeof Connection>;
  private sub?: ReturnType<InstanceType<typeof Connection>["createConsumer"]>;
  private pub?: ReturnType<InstanceType<typeof Connection>["createPublisher"]>;
  // Pitfall RESEARCH.md: chave por IDLead:Numero:channel — sobrevive a deliveryTag reset após REQUEUE
  private readonly retryMap = new Map<string, number>();
  private readonly logger = createLogger();
  // D-13/TECH-03: flag de estado real da conexão RabbitMQ — setado no evento 'connection', resetado no stop()
  private connected = false;

  constructor(private readonly runner: IBrainRunnerLike) {}

  /**
   * D-08: start() abre conexão RabbitMQ e registra consumer.
   * Lança ConfigurationError se qualquer ENV obrigatória estiver ausente.
   * Auto-reconnect gerenciado pelo rabbitmq-client (TRP-05).
   */
  async start(): Promise<void> {
    const url = process.env.RABBITMQ_URL;
    const queue = process.env.RABBITMQ_QUEUE;
    const dlq = process.env.RABBITMQ_DLQ;
    const retryDelayMs = parseInt(process.env.RABBITMQ_RETRY_DELAY_MS ?? "1000", 10);

    // TRP-04: fail-fast — não iniciar sem as 3 ENVs obrigatórias
    // T-07-08 Segurança: não logar valores de env sensíveis (url contém credenciais)
    if (!url || !queue || !dlq) {
      throw new ConfigurationError(
        "RABBITMQ_URL, RABBITMQ_QUEUE e RABBITMQ_DLQ são obrigatórios para TRANSPORT=rabbitmq",
        { hasUrl: !!url, hasQueue: !!queue, hasDlq: !!dlq }
      );
    }

    // TRP-05: auto-reconnect gerenciado pela biblioteca
    this.rabbit = new Connection(url);
    this.rabbit.on("error", (err: unknown) =>
      this.logger.error({ err }, "RabbitMQ connection error")
    );
    this.rabbit.on("connection", () => {
      this.connected = true;
      this.logger.info({}, "RabbitMQ connected");
    });

    // Publisher para DLQ — confirm:true aguarda confirmação do broker (Pitfall 5 do RESEARCH)
    this.pub = this.rabbit.createPublisher({ confirm: true });

    // D-15: prefetch=1 + requeue:false (sem requeue automático — controle manual via retryMap)
    // D-14: filas pré-configuradas por ops — passive:true apenas verifica que a fila existe,
    // sem assertar durable/exclusive/autoDelete (a lib sempre manda QueueDeclare; sem passive,
    // omitir queueOptions ainda declara com os defaults do AMQP (durable:false), que conflita
    // com PRECONDITION_FAILED contra qualquer fila pré-criada como durable:true)
    this.sub = this.rabbit.createConsumer(
      {
        queue,
        queueOptions: { passive: true },
        qos: { prefetchCount: 1 },
        requeue: false,
      },
      async (msg) => {
        // WR-01: guard pub before any DLQ send — pub may be undefined during teardown
        if (!this.pub) {
          this.logger.error({}, "Publisher not available — dropping message (teardown in progress)");
          return ConsumerStatus.ACK;
        }

        // D-16: normalizar corpo antes de validar. rabbitmq-client só faz JSON.parse
        // quando o publisher envia content-type:application/json; sem isso (ex: node
        // RabbitMQ do n8n), o body chega como Buffer/string crua. Parsear aqui torna o
        // consumer tolerante a publishers que não setam o header — se o JSON.parse
        // falhar, segue com o valor original e o safeParse rejeita → DLQ (comportamento
        // inalterado para payload de fato inválido).
        let body: unknown = msg.body;
        if (body instanceof Uint8Array) body = Buffer.from(body).toString("utf8");
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch {
            // deixa como string — safeParse abaixo rejeita e manda pra DLQ
          }
        }

        // T-07-06 / ASVS V5: validar payload antes de qualquer processamento
        const parsed = BrainEventSchema.safeParse(body);

        if (!parsed.success) {
          // Payload inválido — sem retry (schema não vai melhorar com retry)
          // T-07-08 Segurança: não logar body completo (pode conter PII — número, nome, etc.)
          this.logger.error(
            { bodyType: typeof body },
            "Invalid BrainEvent from RabbitMQ — sending to DLQ"
          );
          await this.pub.send(dlq, msg.body);
          return ConsumerStatus.ACK; // ack mensagem original (já está na DLQ)
        }

        // T-07-07: chave de retry por conteúdo (IDLead:Numero:channel) — robusta contra deliveryTag reset
        // D-02/WR-03: append channel suffix to prevent key collision between different
        // message types sharing the same IDLead:Numero pair. "rabbitmq" is this transport's
        // fixed channel — keeps the key human-readable in logs (not a content hash).
        const msgKey = `${parsed.data.IDLead}:${parsed.data.Numero}:rabbitmq`;
        const attempt = (this.retryMap.get(msgKey) ?? 0) + 1;
        this.retryMap.set(msgKey, attempt);

        try {
          // D-10: capturar retorno para logar tokenUsage — sem publicação em fila
          const result = await this.runner.run(parsed.data);
          if (result) {
            // D-10: log de consumo de tokens por turno — apenas números, sem PII (T-17-04)
            this.logger.info({ tokenUsage: result.tokenUsage }, "turn token usage");
          }
          // Sucesso — limpar contador e ACK
          this.retryMap.delete(msgKey);
          return ConsumerStatus.ACK;
        } catch (err) {
          this.logger.error(
            { err, msgKey, attempt },
            "RabbitMQ message processing failed"
          );

          if (attempt >= MAX_ATTEMPTS) {
            // D-16/D-19: após MAX_ATTEMPTS falhas — publicar na DLQ + ACK (sem nack)
            this.logger.error(
              { msgKey, attempt },
              "Max attempts reached — sending to DLQ"
            );
            this.retryMap.delete(msgKey);
            await this.pub.send(dlq, msg.body);
            return ConsumerStatus.ACK;
          }

          // D-17: backoff fixo entre tentativas
          // Nota: prefetch=1 — durante o sleep nenhuma outra mensagem é processada (backpressure)
          await Bun.sleep(retryDelayMs);
          return ConsumerStatus.REQUEUE;
        }
      }
    );

    this.sub.on("error", (err: unknown) =>
      this.logger.error({ err }, "RabbitMQ consumer error")
    );

    this.logger.info({ queue, dlq }, "RabbitMQTransport started");
  }

  /** Encerra consumer, publisher e conexão graciosamente. */
  async stop(): Promise<void> {
    // D-13/TECH-03: setar connected=false antes de fechar conexões
    this.connected = false;
    await this.sub?.close();
    await this.pub?.close();
    await this.rabbit?.close();
    this.retryMap.clear();
    this.logger.info({}, "RabbitMQTransport stopped");
  }

  /**
   * D-13/TECH-03: Retorna estado real da conexão RabbitMQ.
   * connected=true após evento 'connection' + antes de stop().
   * connected=false antes de start() ou após stop().
   */
  getStatus(): TransportStatus {
    return { type: 'rabbitmq', connected: this.connected };
  }
}
