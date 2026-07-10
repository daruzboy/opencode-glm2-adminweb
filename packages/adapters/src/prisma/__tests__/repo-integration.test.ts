// T-080slice: Integration test dengan PostgreSQL nyata (NFR-11). Dijalankan HANYA bila
// env RUN_INTEGRATION_TESTS=1 & DATABASE_URL tersedia. CI menjalankan step terpisah
// setelah migrate deploy. Tujuan: buktikan mapping Prisma + tenant guard $extends
// terhadap DB asli (bukan mock).
//
// Cara jalankan lokal:
//   docker run -d --name pg-test -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/digimaestro \
//   RUN_INTEGRATION_TESTS=1 pnpm --filter @digimaestro/adapters exec vitest run \
//   src/prisma/__tests__/repo-integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';
import { ConversationRepositoryPrisma } from '../conversation-repo-prisma.js';
import { WebsiteRepositoryPrisma } from '../website-repo-prisma.js';
import { RevisionRepositoryPrisma } from '../revision-repo-prisma.js';
import { createPrismaClient } from '../client.js';

const RUN = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!RUN)('Integration: Repository + Tenant Guard (real PostgreSQL)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient();
    // Bersihkan data test.
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.revision.deleteMany();
    await prisma.website.deleteMany();
    await prisma.tenant.deleteMany();
  });

  afterAll(async () => {
    await prisma?.message.deleteMany();
    await prisma?.conversation.deleteMany();
    await prisma?.revision.deleteMany();
    await prisma?.website.deleteMany();
    await prisma?.tenant.deleteMany();
    await prisma?.$disconnect();
  });

  describe('ConversationRepository', () => {
    it('create → findById → update state (happy)', async () => {
      const t = await prisma.tenant.create({ data: { name: 'T-A', slug: 'tenant-a' } });
      const tid = tenantId(t.id);
      const repo = new ConversationRepositoryPrisma(prisma.conversation);

      const created = await repo.create(tid, { channel: 'WEB' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const found = await repo.findById(tid, created.value.id);
      expect(found.ok).toBe(true);
      if (found.ok && found.value) {
        expect(found.value.channel).toBe('WEB');
        expect(found.value.state).toBe('ONBOARDING');
      }

      const updated = await repo.update(tid, created.value.id, { state: 'INTERVIEW' });
      expect(updated.ok).toBe(true);
      if (updated.ok) expect(updated.value.state).toBe('INTERVIEW');
    });

    it('cross-tenant: conversation tenant A invisible to tenant B', async () => {
      const tA = await prisma.tenant.create({ data: { name: 'T-B', slug: 'tenant-b' } });
      const tB = await prisma.tenant.create({ data: { name: 'T-C', slug: 'tenant-c' } });
      const repo = new ConversationRepositoryPrisma(prisma.conversation);

      const created = await repo.create(tenantId(tA.id), { channel: 'WEB' });
      if (!created.ok) return;

      const fromB = await repo.findById(tenantId(tB.id), created.value.id);
      expect(fromB.ok).toBe(true);
      if (fromB.ok) expect(fromB.value).toBeNull();
    });
  });

  describe('WebsiteRepository + RevisionRepository', () => {
    it('website per tenant + revision auto-number', async () => {
      const t = await prisma.tenant.create({ data: { name: 'T-D', slug: 'tenant-d' } });
      const tid = tenantId(t.id);

      // Buat website langsung (website repo tak punya create — dibuat via seed/admin).
      const website = await prisma.website.create({
        data: { tenantId: t.id, slug: 'site-d', status: 'DRAFTING' },
      });

      const wRepo = new WebsiteRepositoryPrisma(prisma.website);
      const rRepo = new RevisionRepositoryPrisma({
        website: prisma.website,
        revision: prisma.revision,
      });

      // findByTenantId
      const found = await wRepo.findByTenantId(tid);
      expect(found.ok).toBe(true);
      if (found.ok && found.value) {
        expect(found.value.slug).toBe('site-d');
      }

      // Create revision #1
      const r1 = await rRepo.create(tid, {
        websiteId: website.id,
        siteDoc: { name: 'Test', pages: [] },
        createdBy: 'agent',
      });
      expect(r1.ok).toBe(true);
      if (r1.ok) expect(r1.value.number).toBe(1);

      // Create revision #2 (auto-increment)
      const r2 = await rRepo.create(tid, {
        websiteId: website.id,
        siteDoc: { name: 'Test v2', pages: [] },
        createdBy: 'agent',
      });
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.value.number).toBe(2);

      // findLatest
      const latest = await rRepo.findLatest(tid, website.id);
      expect(latest.ok).toBe(true);
      if (latest.ok && latest.value) expect(latest.value.number).toBe(2);

      // updateStatus
      const updated = await rRepo.update(tid, website.id, r1.value!.id, { status: 'APPROVED' });
      expect(updated.ok).toBe(true);
      if (updated.ok) expect(updated.value.status).toBe('APPROVED');
    });

    it('cross-tenant: revision invisible to wrong tenant', async () => {
      const tA = await prisma.tenant.create({ data: { name: 'T-E', slug: 'tenant-e' } });
      const tB = await prisma.tenant.create({ data: { name: 'T-F', slug: 'tenant-f' } });
      const wA = await prisma.website.create({ data: { tenantId: tA.id, slug: 'site-e' } });

      const rRepo = new RevisionRepositoryPrisma({
        website: prisma.website,
        revision: prisma.revision,
      });

      const created = await rRepo.create(tenantId(tA.id), {
        websiteId: wA.id,
        siteDoc: {},
        createdBy: 'agent',
      });
      if (!created.ok) return;

      // Tenant B mencoba baca revision milik tenant A → null.
      const fromB = await rRepo.findLatest(tenantId(tB.id), wA.id);
      expect(fromB.ok).toBe(true);
      if (fromB.ok) expect(fromB.value).toBeNull();
    });
  });
});
