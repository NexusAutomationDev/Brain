// SDK-06: BrainOutput — contrato de saída estruturado de todos os Brains
// Definido aqui (packages/shared) para evitar ciclo de dependência:
//   packages/ai NÃO pode importar de packages/core (core já depende de ai).
//   packages/shared é folha — sem dependências internas.

/**
 * Tipo de mídia da resposta do Brain.
 * - "undefined": sem preferência de formato específica — valor padrão do fallback D-10
 * - "text": resposta textual pura
 * - "audio": texto para conversão TTS pelo sistema downstream (D-03)
 * - "image" | "video" | "document": requer mediaType + mediaUrl (D-04)
 */
export type ResponseMode = "undefined" | "text" | "image" | "audio" | "video" | "document";

/**
 * Contrato de saída estruturado de todos os Brains.
 * Interface TypeScript pura — sem Zod (evita dependência de runtime em shared).
 * O schema Zod com validação em runtime está em packages/core/src/output/schema.ts.
 */
export interface BrainOutput {
  /** Texto obrigatório em todos os modos — legenda, acompanhamento ou texto para TTS */
  fullResponse: string;
  /** Tipo de mídia da resposta (D-01, D-02) */
  responseMode: ResponseMode;
  /** MIME type livre (ex: "image/jpeg", "application/pdf") — obrigatório para image/video/document */
  mediaType?: string;
  /** URL externa do arquivo — obrigatório para image/video/document (D-06: sem upload base64) */
  mediaUrl?: string;
}

/**
 * Contagem de tokens consumidos em um turno de conversa.
 * Soma de todos os LLM calls no turno (D-06).
 * Zeros explícitos quando o provider não reporta tokens (D-05).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
