import { z } from "zod";

/**
 * TRP-02, D-01, D-04: BrainEvent schema — campos padronizados para WhatsApp/CRM.
 *
 * Campos anteriores (conversationId, stepIndex, userId, content, metadata) REMOVIDOS (D-02).
 * Sem deprecation shim — quebra intencional para forçar atualização dos consumidores.
 *
 * ASVS V5 Input Validation: valida estrutura antes de qualquer processamento.
 * T-05-01: Zod safeParse valida {Name, Message, Numero, IDLead} todos como string.min(1) —
 * campos ausentes ou tipo errado retornam 400 antes de qualquer processamento.
 */
export const BrainEventSchema = z.object({
  Name: z.string().min(1, "Name is required"),
  Message: z.string().min(1, "Message is required"),
  Numero: z.string().min(1, "Numero is required"),
  IDLead: z.string().min(1, "IDLead is required"),
});

export type BrainEvent = z.infer<typeof BrainEventSchema>;
