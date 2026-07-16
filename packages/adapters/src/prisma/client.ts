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

// Satu client per PROSES (audit 2026-07-16): tiap PrismaClient membawa connection pool
// sendiri (default ±cpu×2+1 koneksi Postgres). Sebelumnya tiap factory composition
// memanggil createPrismaClient() sendiri → ±9 pool per proses api/worker di VPS kecil.
// Composition root memakai singleton ini; createPrismaClient tetap diekspor untuk
// kebutuhan client terpisah (mis. test integrasi dengan cleanup unguarded).
let shared: PrismaClientTenanted | undefined;
export function sharedPrismaClient(): PrismaClientTenanted {
  return (shared ??= createPrismaClient());
}
