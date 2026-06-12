import { z } from "zod";

/**
 * TRANS-02, T-2-02: BrainEvent schema validated with zod on every webhook request.
 *
 * ASVS V5 Input Validation: validate structure before any processing.
 * This prevents prompt injection via malformed event fields.
 */
export const BrainEventSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  stepIndex: z.number().int().nonnegative("stepIndex must be a non-negative integer"),
  userId: z.string().min(1, "userId is required"),
  content: z.string().min(1, "content is required"),
  // Optional metadata — plain object only, no nested functions
  metadata: z.record(z.unknown()).optional(),
});

export type BrainEvent = z.infer<typeof BrainEventSchema>;
