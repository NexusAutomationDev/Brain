// packages/ai — barrel export for all public symbols

// Graph primitives
export { BrainStateAnnotation } from "./graph/state.js";
export type { BrainState } from "./graph/state.js";
export { createCheckpointer } from "./graph/checkpointer.js";

// LLM factory
export { createLLM } from "./llm/factory.js";
export type { LLMOptions } from "./llm/factory.js";

// Resiliência de LLM — cadeia de fallback em erro transitório de provider
export { withModelFallback, isTransientProviderError } from "./llm/fallback.js";
export type { FallbackCandidate } from "./llm/fallback.js";

// Token usage helper — D-07
export { extractTokenUsage } from "./utils/token.js";
