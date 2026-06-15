// SDK-06: BrainOutputSchema — schema Zod para validação em runtime do contrato de saída.
// D-01 a D-06: definições de campo conforme contexto da Fase 10.
// Pitfall 3: BrainOutputSchema.parse() lança ZodError — envolver em try/catch no runner
//            para relançar como BrainOutputValidationError.

import { z } from "zod";

export const ResponseModeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "document",
]);

// D-04: image, video e document exigem mediaType + mediaUrl
const MODES_REQUIRING_MEDIA = ["image", "video", "document"] as const;

export const BrainOutputSchema = z
  .object({
    /** Texto obrigatório em todos os modos — legenda, acompanhamento ou texto para TTS (D-03) */
    fullResponse: z.string().min(1, "fullResponse is required and cannot be empty"),
    /** Tipo de mídia da resposta — enum restrito (D-02) */
    responseMode: ResponseModeSchema,
    /** MIME type livre (ex: "image/jpeg") — obrigatório quando responseMode requer mídia (D-05) */
    mediaType: z.string().optional(),
    /** URL externa — obrigatório quando responseMode requer mídia; sem upload base64 (D-06) */
    mediaUrl: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // D-04: validação condicional — image, video, document exigem mediaType + mediaUrl
    const needsMedia = (MODES_REQUIRING_MEDIA as readonly string[]).includes(
      data.responseMode
    );
    if (needsMedia) {
      if (!data.mediaType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `mediaType is required when responseMode is "${data.responseMode}"`,
          path: ["mediaType"],
        });
      }
      if (!data.mediaUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `mediaUrl is required when responseMode is "${data.responseMode}"`,
          path: ["mediaUrl"],
        });
      }
    }
  });

// Nota: ResponseMode e BrainOutput types são re-exportados de @brain-pkg/shared
// para evitar duplicação. packages/core importa de shared (direção permitida).
export type { ResponseMode, BrainOutput } from "@brain-pkg/shared";
