// SDK-03: ToolsRegistry — controls which tools are permitted per brainType.
// D-12: Keyed by brainType (string) → whitelist Set<toolName>.
// A3: brainType not registered throws ConfigurationError (not silent empty []).
//     This catches misconfiguration at startup rather than silently running without tools.

import { ConfigurationError } from "@brain-pkg/shared";
import type { StructuredTool } from "@langchain/core/tools";

/**
 * SDK-03: Registry of allowed tools per brainType.
 *
 * Usage:
 *   const registry = new ToolsRegistry();
 *   registry.enableTool("echo", "searchTool");
 *   const filtered = registry.getTools("echo", brain.tools);
 */
export class ToolsRegistry {
  // brainType → Set of allowed tool names (whitelist)
  private registry = new Map<string, Set<string>>();

  /**
   * Register a brainType with no tools (for brains that use tools: []).
   * No-op if already registered.
   */
  registerBrainType(brainType: string): void {
    if (!this.registry.has(brainType)) {
      this.registry.set(brainType, new Set());
    }
  }

  /**
   * Register a brainType with an allowed tool.
   * Creates the brainType entry if it does not exist.
   */
  enableTool(brainType: string, toolName: string): void {
    if (!this.registry.has(brainType)) {
      this.registry.set(brainType, new Set());
    }
    this.registry.get(brainType)!.add(toolName);
  }

  /**
   * Remove a tool from the allowed set for a brainType.
   * No-op if brainType or toolName does not exist.
   */
  disableTool(brainType: string, toolName: string): void {
    this.registry.get(brainType)?.delete(toolName);
  }

  /**
   * Return only the tools from brainTools that are whitelisted for brainType.
   *
   * Throws ConfigurationError if brainType has never been registered via enableTool().
   * This prevents silent "no tools" scenarios from misconfiguration.
   *
   * @param brainType - Brain category to look up
   * @param brainTools - Full list of tools from IBrain.tools[]
   */
  getTools(brainType: string, brainTools: StructuredTool[]): StructuredTool[] {
    const allowed = this.registry.get(brainType);
    if (!allowed) {
      throw new ConfigurationError(
        `brainType not registered in ToolsRegistry: ${brainType}`,
        { brainType }
      );
    }
    return brainTools.filter((t) => allowed.has(t.name));
  }
}
