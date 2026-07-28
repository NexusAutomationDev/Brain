// EVT-01, EVT-02, EVT-04: EventPublisher — canal de saída para resultados de tools
// D-06: RabbitMQ tem prioridade sobre webhook quando ambos os ENVs estão presentes
// D-08: Falhas de publicação são absorvidas silenciosamente (fire-and-forget) — nunca bloquear resposta ao lead
// T-20-02: PII (nome, numero, id) nunca aparece em logs — apenas eventId em warn de falha
// T-20-03: RABBITMQ_URL nunca é logado — apenas boolean de presença em ConfigurationError
// T-20-05: AbortSignal.timeout(5000) — máximo 5s de espera por request webhook

import { Connection } from "rabbitmq-client";
import { createLogger } from "@brain-pkg/observability";
import { ConfigurationError } from "@brain-pkg/shared";

export interface ToolEvent {
  event_id: string;    // `${threadId}:${toolCallId}`  (EVT-04)
  action: string;      // "qualify_lead" | "pause_session" | "finish_conversation"
  lead: {
    id: string;        // lead.uniqueId
    nome: string | null;
    numero: string;
  };
  result: string;      // ToolMessage.content raw (D-05); JSON.stringify se for array
  timestamp: string;   // new Date().toISOString()
}

export interface IEventPublisher {
  publish(events: ToolEvent[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * EVT-06: contrato genérico do SDK — resultado de tool marcado como falha não vira evento.
 *
 * Uma tool cujo resultado é um objeto JSON com `status: "error"` está sinalizando que a
 * operação NÃO foi executada. Esse resultado não representa um desfecho de negócio e não
 * deve chegar ao consumidor externo, que o interpretaria como decisão real — ex: uma
 * qualificação que falhou por erro de LLM seria lida como lead desqualificado.
 *
 * Regra vale para qualquer tool de qualquer Brain; não há special-case por nome de tool.
 * A ausência do campo `status` significa sucesso, então nenhuma payload já existente muda
 * de comportamento. Conteúdo não-JSON (texto puro) também segue sendo publicado.
 */
export function isErrorToolResult(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as { status?: unknown }).status === "error"
    );
  } catch {
    return false;
  }
}

/**
 * NoopEventPublisher: usado quando TOOL_EVENTS_URL e TOOL_EVENTS_QUEUE estão ausentes.
 * BrainRunner usa NoopEventPublisher — EventPublisher nunca é instanciado sem ENVs.
 */
export class NoopEventPublisher implements IEventPublisher {
  async publish(_events: ToolEvent[]): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * EventPublisher: publica eventos de tool results para sistemas externos.
 *
 * Modos:
 *   - "rabbitmq": TOOL_EVENTS_QUEUE + RABBITMQ_URL (prioridade — D-06)
 *   - "webhook":  TOOL_EVENTS_URL (fallback quando queue ausente)
 *
 * Construtor lança ConfigurationError se:
 *   - TOOL_EVENTS_QUEUE presente mas RABBITMQ_URL ausente
 *   - Nem TOOL_EVENTS_QUEUE nem TOOL_EVENTS_URL estão presentes
 *
 * init() deve ser chamado após o construtor para inicializar conexão RabbitMQ (se no-op em webhook).
 */
export class EventPublisher implements IEventPublisher {
  private readonly logger = createLogger();
  private readonly mode: "webhook" | "rabbitmq";
  private readonly webhookUrl?: string;
  private readonly queue?: string;
  private rabbit?: InstanceType<typeof Connection>;
  private pub?: ReturnType<InstanceType<typeof Connection>["createPublisher"]>;

  constructor() {
    const queue = process.env.TOOL_EVENTS_QUEUE?.trim();
    const webhookUrl = process.env.TOOL_EVENTS_URL?.trim();

    if (queue) {
      // D-06: RabbitMQ tem prioridade — ignora webhookUrl quando queue presente
      // T-20-03: Segurança — não logar RABBITMQ_URL (contém credenciais); apenas boolean
      if (!process.env.RABBITMQ_URL) {
        throw new ConfigurationError(
          "TOOL_EVENTS_QUEUE requer RABBITMQ_URL configurado",
          { hasQueue: true, hasRabbitUrl: false }
        );
      }
      this.mode = "rabbitmq";
      this.queue = queue;
    } else if (webhookUrl) {
      this.mode = "webhook";
      this.webhookUrl = webhookUrl;
    } else {
      // BrainRunner.init() só cria EventPublisher quando pelo menos um ENV está presente.
      // Este branch indica uso incorreto do construtor diretamente.
      throw new ConfigurationError(
        "EventPublisher requer TOOL_EVENTS_QUEUE ou TOOL_EVENTS_URL",
        { hasQueue: false, hasUrl: false }
      );
    }
  }

  /**
   * Inicializa conexão RabbitMQ eagerly.
   * Chamado por BrainRunner.init() após construção.
   * No-op em modo webhook.
   */
  async init(): Promise<void> {
    if (this.mode === "rabbitmq") {
      // D-09: reutiliza RABBITMQ_URL existente; confirm:true aguarda ack do broker
      this.rabbit = new Connection(process.env.RABBITMQ_URL!);
      this.pub = this.rabbit.createPublisher({ confirm: true });
    }
  }

  async publish(events: ToolEvent[]): Promise<void> {
    for (const event of events) {
      if (this.mode === "webhook") {
        await this._publishWebhook(event);
      } else {
        await this._publishRabbitMQ(event);
      }
    }
  }

  private async _publishWebhook(event: ToolEvent): Promise<void> {
    try {
      await fetch(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        // T-20-05: AbortSignal.timeout(5000) — máximo 5s; qualquer erro absorvido em catch (D-08)
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      // D-08: absorver silenciosamente — nunca bloquear a resposta ao lead
      // T-20-02 Segurança: logar apenas eventId, nunca payload completo (PII: nome, numero, id)
      this.logger.warn(
        { err, eventId: event.event_id },
        "Webhook event publish failed — ignoring (fire-and-forget)"
      );
    }
  }

  private async _publishRabbitMQ(event: ToolEvent): Promise<void> {
    if (!this.pub) {
      this.logger.warn(
        { eventId: event.event_id },
        "RabbitMQ publisher not ready — ignoring (init() not called or teardown in progress)"
      );
      return;
    }
    try {
      await this.pub.send(this.queue!, event);
    } catch (err) {
      // D-08: absorver silenciosamente
      // T-20-02 Segurança: logar apenas eventId, nunca payload completo (PII)
      this.logger.warn(
        { err, eventId: event.event_id },
        "RabbitMQ event publish failed — ignoring (fire-and-forget)"
      );
    }
  }

  async close(): Promise<void> {
    await this.pub?.close();
    await this.rabbit?.close();
  }
}
