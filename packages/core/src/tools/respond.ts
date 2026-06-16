// RESP-01: createRespondTool — schema-as-tool para responseMode dinâmico.
// D-03: Schema Zod v4 com fullResponse, responseMode, mediaType, mediaUrl.
// D-09: Factory stateless — sem closure sobre sql (respond tool não toca banco).
// PITFALL-6 mitigation: description instrui o LLM a sempre invocar esta tool.

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "@brain-pkg/observability";

const logger = createLogger();

// D-03: Schema da respond tool — Zod v4 (packages/core usa ^4.4.3)
// PITFALL-5: usar z.string().url() (ZodString), NÃO z.url() (ZodURL — tipo diferente em Zod v4)
const respondToolSchema = z
  .object({
    fullResponse: z
      .string()
      .describe(
        "Mensagem completa da resposta em formato contínuo, sem divisões. OBRIGATÓRIO — sempre preencha com o texto completo da sua resposta."
      ),
    responseMode: z
      .enum(["undefined", "text", "audio"])
      .describe(
        "Modo de entrega da resposta. Use 'undefined' quando não há preferência de formato específica. Use 'audio' quando o usuário pedir explicitamente para ouvir a resposta. Use 'text' para respostas textuais explícitas."
      ),
    mediaType: z
      .enum(["image", "file", "video", "audio"])
      .optional()
      .describe(
        "Tipo da mídia enviada em mediaUrl. Obrigatório quando mediaUrl estiver presente."
      ),
    mediaUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "URL direta de download de um arquivo de mídia (https://). Obrigatório quando mediaType estiver presente."
      ),
  })
  .superRefine((data, ctx) => {
    // D-03: validação condicional — mediaType e mediaUrl são co-dependentes
    if (data.mediaType && !data.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediaUrl é obrigatório quando mediaType está presente",
        path: ["mediaUrl"],
      });
    }
    if (data.mediaUrl && !data.mediaType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediaType é obrigatório quando mediaUrl está presente",
        path: ["mediaType"],
      });
    }
  });

/**
 * RESP-01: Cria a respond tool para responseMode dinâmico via schema-as-tool.
 *
 * O LLM invoca esta tool como último passo de cada turno, sinalizando o
 * formato de resposta desejado (fullResponse + responseMode).
 *
 * Factory stateless — não requer closure sobre sql ou outros recursos.
 * Compatível com OpenAI e Anthropic via bindTools() (RESP-03).
 *
 * @returns DynamicStructuredTool com nome "respond"
 */
export function createRespondTool() {
  return tool(
    async (args) => {
      // D-09: apenas loga — o nó respond em brain.ts lê state.messages para extrair os args
      logger.info({ responseMode: args.responseMode }, "respond tool called");
      return "ok";
    },
    {
      name: "respond",
      description:
        "SEMPRE invoque esta tool ao final da sua resposta para confirmar o formato de entrega. " +
        "Preencha fullResponse com o texto completo da sua mensagem. " +
        "Escolha responseMode baseado no contexto: 'audio' se o usuário pediu para ouvir, " +
        "'text' para resposta textual explícita, 'undefined' quando não há preferência específica.",
      schema: respondToolSchema,
    }
  );
}
