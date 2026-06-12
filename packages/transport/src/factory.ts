import { ConfigurationError } from "@brain-pkg/shared";
import { WebhookTransport } from "./webhook/handler.js";
import type { ITransport } from "./interface.js";

/**
 * TRANS-04, D-05: Factory to select transport implementation by env var.
 *
 * TRANSPORT env var: "webhook" (v1 default). RabbitMQ deferred to v2.
 * If TRANSPORT is not set, defaults to "webhook".
 * If TRANSPORT has an unknown value, throws ConfigurationError.
 */
export function createTransport(transport?: string): ITransport {
  const type = transport ?? process.env.TRANSPORT ?? "webhook";

  switch (type) {
    case "webhook":
      return new WebhookTransport();
    default:
      throw new ConfigurationError(`Unknown TRANSPORT: ${type}`, { transport: type });
  }
}
