import {
  ConversationRepositoryPrisma,
  MessageRepositoryPrisma,
  createPrismaClient,
  type ConversationDelegate,
  type MessageDelegate,
} from '@digimaestro/adapters';
import type { ChatDeps } from './chat/handle-incoming.js';

// Composition root (apps/api): instantiate adapter konkret & suntikkan ke use case
// (SOLID-D). Prisma client di-guard tenantId via $extends (T-021). Dipanggil saat
// buildServer tanpa deps eksplisit (server nyata, butuh DATABASE_URL); test menyuntik
// deps fake sehingga tanpa DB.
//
// Catatan cast: delegate Prisma (typed enum literal) tidak assignable struktural ke
// interface sempit repo (string) — perbedaan tipe enumer saja, bukan perilaku. Cast
// `as unknown as` di batas adapter ini aman: repo tetap menyuntik tenantId & teruji.
export function createChatDeps(): ChatDeps {
  const prisma = createPrismaClient();
  return {
    conversations: new ConversationRepositoryPrisma(prisma.conversation as unknown as ConversationDelegate),
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
  };
}
