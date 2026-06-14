import { ConfigurationError } from "@brain-pkg/shared";
import { WebhookTransport } from "./webhook/handler.js";
import { RabbitMQTransport } from "./rabbitmq/consumer.js";
import type { IBrainRunnerLike } from "./webhook/handler.js";
import type { ITransport } from "./interface.js";

/**
 * TRANS-04, D-07, TRP-06: Factory para seleção de transport por ENV.
 *
 * TRANSPORT env var:
 *   "webhook"  — WebhookTransport (Hono HTTP, padrão)
 *   "rabbitmq" — RabbitMQTransport (rabbitmq-client, Phase 7)
 *
 * ConfigurationError se TRANSPORT tiver valor desconhecido.
 *
 * @param runner - Optional BrainRunner-compatible instance passed to transport constructor.
 *   T-05-02: WebhookTransport.start() will throw ConfigurationError if runner is absent.
 *   TRP-04: RabbitMQTransport.start() throws ConfigurationError if RABBITMQ_* ENVs absent.
 */
export function createTransport(runner?: IBrainRunnerLike): ITransport {
  const type = process.env.TRANSPORT ?? "webhook";

  switch (type) {
    case "webhook":
      return new WebhookTransport(runner);
    case "rabbitmq":
      return new RabbitMQTransport(runner!);
    default:
      throw new ConfigurationError(`Unknown TRANSPORT: ${type}`, { transport: type });
  }
}
