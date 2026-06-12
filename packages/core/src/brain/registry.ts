// SDK-01: BrainRegistry — stores IBrain instances mapped by id.
// Registered once at startup; resolved per request by BrainRunner.

import { ConfigurationError } from "@brain-pkg/shared";
import type { IBrain } from "./interface.js";

/**
 * SDK-01: Registry for IBrain instances.
 * Maps brainId → IBrain instance. Throws ConfigurationError on conflicts.
 */
export class BrainRegistry {
  private registry = new Map<string, IBrain>();

  /**
   * Register an IBrain instance. Throws if id already registered.
   */
  register(brain: IBrain): void {
    if (this.registry.has(brain.id)) {
      throw new ConfigurationError(
        `Brain already registered: ${brain.id}`,
        { brainId: brain.id }
      );
    }
    this.registry.set(brain.id, brain);
  }

  /**
   * Resolve an IBrain by id. Throws ConfigurationError if not found.
   */
  resolve(brainId: string): IBrain {
    const brain = this.registry.get(brainId);
    if (!brain) {
      throw new ConfigurationError(
        `Brain not found: ${brainId}`,
        { brainId }
      );
    }
    return brain;
  }
}
