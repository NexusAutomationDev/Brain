import { ConfigurationError } from "@brain-pkg/shared";
import { WebhookTransport } from "./webhook/handler.js";
import type { IBrainRunnerLike } from "./webhook/handler.js";
import type { ITransport } from "./interface.js";

/**
 * TRANS-04, D-07: Factory to select transport implementation by env var.
 *
 * TRANSPORT env var: "webhook" (v1 default). RabbitMQ planned for Phase 7.
 * If TRANSPORT is not set, defaults to "webhook".
 * If TRANSPORT has an unknown value, throws ConfigurationError.
 *
 * @param runner - Optional BrainRunner-compatible instance passed to transport constructor.
 *   T-05-02: WebhookTransport.start() will throw ConfigurationError if runner is absent.
 */
export function createTransport(runner?: IBrainRunnerLike): ITransport {
  const type = process.env.TRANSPORT ?? "webhook";

  switch (type) {
    case "webhook":
      return new WebhookTransport(runner);
    default:
      throw new ConfigurationError(`Unknown TRANSPORT: ${type}`, { transport: type });
  }
}
