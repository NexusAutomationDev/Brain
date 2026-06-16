import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { BrainOutput, TokenUsage } from "@brain-pkg/shared";

/**
 * AI-03: Brain graph state schema.
 *
 * Constraints (AI-03):
 * - Only JSON-safe primitives: string, number, boolean, null, plain object, array
 * - No Set, Map, Date, or Buffer — these fail JSON round-trip through PostgresSaver
 * - schema_version uses last-write-wins reducer (NOT messagesStateReducer) to avoid corruption
 *   on state resume
 *
 * schema_version: Increment when shape changes. Allows forward-compatibility checks.
 */
export const BrainStateAnnotation = Annotation.Root({
  // AI-03: schema_version uses last-write-wins reducer — NOT messagesStateReducer
  schema_version: Annotation<number>({
    default: () => 2, // incrementado: tokenUsage adicionado ao shape
    reducer: (_, next) => next,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  // JSON-safe string identifiers only — no Date objects
  userId: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  sessionId: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  // SDK-06: D-09/D-10 — brainOutput: contrato de saída estruturado
  // last-write-wins: o nó do grafo define o valor; reducer descarta o anterior
  // Default: null — nó DEVE setar; BrainRunner valida e lança erro se null após invoke
  // Nota: BrainOutput importado de @brain-pkg/shared (não @brain-pkg/core) para evitar ciclo
  // de dependência — core já depende de ai; ver RESEARCH.md Pitfall 1 e Open Questions RESOLVED.
  brainOutput: Annotation<BrainOutput | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  // D-06, D-07: tokenUsage — acumulador de tokens por turno
  // Reducer de soma (diferente de last-write-wins): cada nó llm retorna delta,
  // BrainStateAnnotation acumula todos os LLM calls do turno.
  // Default: zeros (não null) — garante que state.tokenUsage nunca é undefined após invoke() (Pitfall 2)
  tokenUsage: Annotation<TokenUsage>({
    default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    reducer: (prev, next) => ({
      inputTokens: (prev?.inputTokens ?? 0) + (next?.inputTokens ?? 0),
      outputTokens: (prev?.outputTokens ?? 0) + (next?.outputTokens ?? 0),
      totalTokens: (prev?.totalTokens ?? 0) + (next?.totalTokens ?? 0),
    }),
  }),
});

/**
 * AI-03: Type alias for the full state shape.
 * Use this type in all node function signatures.
 */
export type BrainState = typeof BrainStateAnnotation.State;
