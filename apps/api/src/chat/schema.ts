import { z } from 'zod';

// Validasi tepi sistem (SRS §4.3) untuk pesan masuk web chat (T-040, FR-CHN-003).
export const inboundMessageSchema = z.object({
  conversationId: z.string().min(1).max(100).optional(),
  text: z.string().min(1).max(4000),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
