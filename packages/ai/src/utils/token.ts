import type { AIMessage } from "@langchain/core/messages";
import type { TokenUsage } from "@brain-pkg/shared";

/**
 * Extrai dados de consumo de tokens de um AIMessage.
 *
 * D-04: Converte snake_case do LangChain (input_tokens, output_tokens, total_tokens)
 * para camelCase do projeto (inputTokens, outputTokens, totalTokens).
 *
 * D-05: Retorna zeros explícitos quando o provider não reporta usage_metadata.
 * Nunca retorna undefined — contrato da resposta HTTP é previsível.
 *
 * Anti-pattern: NÃO usar mergeUsageMetadata() do LangChain no reducer —
 * essa função opera em snake_case; o projeto usa camelCase (RESEARCH.md).
 */
export function extractTokenUsage(response: AIMessage): TokenUsage {
  const meta = response.usage_metadata;
  if (!meta) {
    // D-05: zeros explícitos quando provider não reporta tokens
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
  return {
    inputTokens: meta.input_tokens,
    outputTokens: meta.output_tokens,
    totalTokens: meta.total_tokens,
  };
}
