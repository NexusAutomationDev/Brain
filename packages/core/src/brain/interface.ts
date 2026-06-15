// SDK-01: IBrain contract — the minimal interface any Brain must implement.
// D-01: buildGraph() receives dependencies injected by BrainRunner (llm, prompts, tools).
// D-02: buildGraph() returns StateGraph NOT compiled — BrainRunner calls .compile({ checkpointer }).
// D-03: tools[] are StructuredTool instances (pre-built). ToolsRegistry filters them before inject.
// D-04: All Brains use BrainStateAnnotation without field extensions in v1.

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredTool } from "@langchain/core/tools";
import type { StateGraph } from "@langchain/langgraph";
import type { BrainStateAnnotation } from "@brain-pkg/ai";

/**
 * Dependencies injected by BrainRunner into buildGraph().
 * Brain uses these to wire nodes and edges — no external deps needed.
 */
export interface BrainBuildContext {
  /** LLM instance from createLLM() — provider configured via env */
  llm: BaseChatModel;
  /** Prompts loaded from prompts table: { [key]: content } */
  prompts: Record<string, string>;
  /** Brain's tools[] filtered by ToolsRegistry for this brainType */
  tools: StructuredTool[];
}

/**
 * SDK-01: Minimal contract for all Brain implementations.
 * Brains define their identity, prompt keys, tools, and graph structure.
 * Orchestration (checkpointing, memory, transport) is BrainRunner's responsibility.
 */
export interface IBrain {
  /** Unique Brain instance identifier (e.g., "sdr-brain-prod") */
  id: string;
  /** Brain category used for ToolsRegistry lookup and prompts scoping (e.g., "sdr", "support") */
  brainType: string;
  /** Keys to load from prompts table for this brainType at startup */
  promptKeys: string[];
  /**
   * Optional default prompt content — { [key]: content } where keys match promptKeys.
   * When defined, POST /reload-prompts upserts these to the DB before reloading.
   * Allows code to be the source of truth: deploy new code → call /reload-prompts → done.
   */
  defaultPrompts?: Record<string, string>;
  /** Full tool list — Runner filters via ToolsRegistry before injection */
  tools: StructuredTool[];
  /**
   * D-02: Returns StateGraph NOT compiled.
   * BrainRunner calls .compile({ checkpointer }) — never call .compile() here.
   */
  buildGraph(ctx: BrainBuildContext): StateGraph<typeof BrainStateAnnotation>;
}
