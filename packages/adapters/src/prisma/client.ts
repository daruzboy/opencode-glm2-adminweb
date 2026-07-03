// Composition root helper: Prisma client dgn tenant guard ter-pasang (NFR-09).
// `@prisma/client` tetap hanya di packages/adapters (SOLID-D); apps/api memanggil
// helper ini tanpa import langsung @prisma/client.
//
// Penggunaan (composition root di apps/*):
//   const prisma = createPrismaClient();
//   const conversations = new ConversationRepositoryPrisma(prisma.conversation);
//   const messages = new MessageRepositoryPrisma(prisma.message);

import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from './tenant-guard.js';

export function createPrismaClient() {
  return new PrismaClient().$extends(tenantGuardExtension);
}

export type PrismaClientTenanted = ReturnType<typeof createPrismaClient>;
