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
  private readonly registry = new Map<string, Set<string>>();

  // WR-03: BRAIN_TOOLS parsed once at construction to avoid inconsistency if env
  // changes between enableTool() calls during startup. null = no filter (all allowed).
  private readonly envWhitelist: Set<string> | null;

  constructor() {
    const raw = process.env.BRAIN_TOOLS;
    if (raw !== undefined) {
      // WR-02: filter(Boolean) removes empty strings produced by BRAIN_TOOLS=""
      const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
      // WR-02: treat BRAIN_TOOLS="" (parsed.length === 0) as "unset" — all tools allowed
      this.envWhitelist = parsed.length > 0 ? new Set(parsed) : null;
    } else {
      this.envWhitelist = null;
    }
  }

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
    // WR-01: Always register the brainType entry first so getTools() never throws
    // ConfigurationError when BRAIN_TOOLS filters out all tools for this brainType.
    if (!this.registry.has(brainType)) {
      this.registry.set(brainType, new Set());
    }

    // D-07/D-08/D-09: BRAIN_TOOLS whitelist — ausente = sem filtro (TOOLS-ENV-01, TOOLS-ENV-02)
    // envWhitelist is null when BRAIN_TOOLS is unset or empty (WR-02, WR-03)
    if (this.envWhitelist !== null && !this.envWhitelist.has(toolName)) {
      return; // silently ignored — sem log, sem erro (D-07)
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
