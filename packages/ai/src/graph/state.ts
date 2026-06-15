import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { BrainOutput } from "@brain-pkg/shared";

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
    default: () => 1,
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
});

/**
 * AI-03: Type alias for the full state shape.
 * Use this type in all node function signatures.
 */
export type BrainState = typeof BrainStateAnnotation.State;
