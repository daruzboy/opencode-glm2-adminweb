// T-080: Integration test dengan PostgreSQL NYATA (NFR-11) — membuktikan mapping Prisma +
// tenant guard $extends terhadap DB asli, bukan mock.
//
// UTANG YANG DIBAYAR (dua bug yang membuat test ini BOHONG):
//   1. Di-gate `RUN_INTEGRATION_TESTS=1` yang TAK PERNAH diset di CI → SELALU di-skip.
//      CI "hijau" selama berbulan-bulan tanpa test ini pernah benar-benar jalan.
//   2. Setup/teardown memakai `createPrismaClient()` (ber-tenantGuard) → `deleteMany()`
//      TANPA `where` melanggar guard → `TenantGuardError`. Jadi seandainya flag-nya
//      dinyalakan pun, test ini TETAP gagal.
//
// Perbaikan: klien BERSIH (tanpa guard) untuk setup/teardown — guard memang HARUS menolak
// query tanpa tenantId, itu fiturnya. Klien BER-GUARD tetap dipakai untuk menguji guardnya.
// CI kini menjalankannya (Postgres service + DATABASE_URL sudah ada di workflow).
//
// Jalankan lokal:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/digimaestro \
//   RUN_INTEGRATION_TESTS=1 pnpm --filter @digimaestro/adapters exec vitest run \
//     src/prisma/__tests__/repo-integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';
import { ConversationRepositoryPrisma } from '../conversation-repo-prisma.js';
import { WebsiteRepositoryPrisma } from '../website-repo-prisma.js';
import { RevisionRepositoryPrisma } from '../revision-repo-prisma.js';
import { createPrismaClient } from '../client.js';
import {
  ChannelBindingPrisma,
  InviteCodePrisma,
  QuotaPrisma,
} from '../onboarding-prisma.js';

// Jalan bila DATABASE_URL ada (CI menyediakannya) ATAU flag eksplisit. Sebelumnya HANYA
// flag → dan flag itu tak pernah diset di CI, jadi test ini tak pernah jalan sama sekali.
const RUN = process.env.RUN_INTEGRATION_TESTS === '1' || Boolean(process.env.DATABASE_URL);

// Setup/teardown WAJIB memakai klien TANPA guard: `deleteMany()` tanpa `where` memang
// dilarang guard — itu FITUR (NFR-09), bukan bug. Memakai klien ber-guard di sini justru
// membuktikan kita salah paham terhadap guard buatan sendiri.
async function bersihkan(db: PrismaClient): Promise<void> {
  // Urutan: anak → induk (FK).
  await db.channelBinding.deleteMany();
  await db.llmUsage.deleteMany();
  await db.mediaAsset.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.revision.deleteMany();
  await db.website.deleteMany();
  await db.tenant.deleteMany();
  await db.inviteCode.deleteMany();
}

describe.skipIf(!RUN)('Integration: Repository + Tenant Guard (PostgreSQL NYATA)', () => {
  // Ber-guard → dipakai MENGUJI guard & repo (jalur produksi).
  let prisma: PrismaClient;
  // Tanpa guard → hanya untuk setup/teardown.
  let raw: PrismaClient;

  beforeAll(async () => {
    // PENGAMAN anti "hijau bohong": bila seseorang MENYURUH test ini jalan
    // (RUN_INTEGRATION_TESTS=1) tapi DATABASE_URL hilang, GAGAL keras — jangan diam-diam
    // di-skip lagi seperti dulu. Skip yang tak terlihat itulah yang membuat CI berbohong
    // selama berbulan-bulan.
    if (process.env.RUN_INTEGRATION_TESTS === '1' && !process.env.DATABASE_URL) {
      throw new Error(
        'RUN_INTEGRATION_TESTS=1 tapi DATABASE_URL kosong — integration test TIDAK boleh di-skip diam-diam',
      );
    }
    raw = new PrismaClient();
    prisma = createPrismaClient();
    await bersihkan(raw);
  });

  afterAll(async () => {
    if (raw) {
      await bersihkan(raw);
      await raw.$disconnect();
    }
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
  // Guard NFR-09 terhadap DB NYATA: yang diuji unit-test cuma "repo menyuntik tenantId".
  // Di sini kita buktikan guard runtime ($extends) benar-benar MENOLAK query telanjang —
  // pertahanan terakhir bila suatu saat ada kode yang memakai prisma mentah.
  describe('Tenant guard runtime ($extends) — DB nyata', () => {
    it('query tanpa tenantId LEWAT klien ber-guard → DITOLAK', async () => {
      await expect(
        // deleteMany tanpa where = persis pola yang dulu membuat test ini gagal.
        (prisma as unknown as { conversation: { deleteMany: () => Promise<unknown> } }).conversation.deleteMany(),
      ).rejects.toThrow();
    });

    it('klien BERSIH (tanpa guard) boleh — dipakai HANYA untuk setup/teardown', async () => {
      await expect(raw.conversation.deleteMany()).resolves.toBeDefined();
    });
  });

  // Dedup idempotensi kanal (FR-CHN-005) bertumpu pada constraint DB, bukan cek-lalu-tulis.
  // Ini HANYA bisa dibuktikan terhadap Postgres nyata.
  describe('Constraint DB yang menopang idempotensi — DB nyata', () => {
    it('providerMsgId @unique → pesan duplikat DITOLAK DB (dasar dedup webhook)', async () => {
      const t = await raw.tenant.create({ data: { name: 'T-Dedup', slug: 'tenant-dedup' } });
      const conv = await raw.conversation.create({
        data: { tenantId: t.id, channel: 'TELEGRAM', externalId: '555' },
      });
      const pesan = {
        tenantId: t.id,
        conversationId: conv.id,
        direction: 'IN' as const,
        type: 'TEXT' as const,
        providerMsgId: 'tg-555-42',
        status: 'DELIVERED' as const,
      };

      await raw.message.create({ data: pesan });
      // Kiriman ulang webhook dgn providerMsgId sama → constraint menolak.
      await expect(raw.message.create({ data: pesan })).rejects.toThrow();
    });

    it('Conversation @@unique(tenantId, channel, externalId) → chat sama tak dobel', async () => {
      const t = await raw.tenant.create({ data: { name: 'T-Conv', slug: 'tenant-conv' } });
      const data = { tenantId: t.id, channel: 'TELEGRAM' as const, externalId: '777' };

      await raw.conversation.create({ data });
      await expect(raw.conversation.create({ data })).rejects.toThrow();
    });

    it('Website.tenantId @unique → satu website per tenant (BRU-01)', async () => {
      const t = await raw.tenant.create({ data: { name: 'T-Web', slug: 'tenant-web' } });

      await raw.website.create({ data: { tenantId: t.id, slug: 'situs-satu' } });
      await expect(
        raw.website.create({ data: { tenantId: t.id, slug: 'situs-dua' } }),
      ).rejects.toThrow();
    });
  });

  // Self-serve (#6): DUA operasi yang WAJIB atomik. Mock TIDAK BISA membuktikan ini —
  // hanya DB nyata dengan operasi paralel yang bisa.
  describe('Self-serve: atomisitas kode undangan & kuota — DB nyata', () => {
    it('kode maxUses=1 ditukar 5x PARALEL → HANYA 1 yang berhasil', async () => {
      const invites = new InviteCodePrisma(raw as never);
      await raw.inviteCode.create({ data: { code: 'RACE1', maxUses: 1 } });

      // Cek-lalu-tulis akan meloloskan beberapa di sini. UPDATE bersyarat tidak.
      const hasil = await Promise.all([
        invites.redeem('RACE1'),
        invites.redeem('RACE1'),
        invites.redeem('RACE1'),
        invites.redeem('RACE1'),
        invites.redeem('RACE1'),
      ]);

      expect(hasil.filter((r) => r.ok)).toHaveLength(1);
      expect(hasil.filter((r) => !r.ok)).toHaveLength(4);
    });

    it('kuota 3 pesan, 10 konsumsi PARALEL → berhenti tepat di 3', async () => {
      const q = new QuotaPrisma(raw as never);
      const t = await raw.tenant.create({
        data: { name: 'T-Kuota', slug: 'tenant-kuota', quotaMessages: 3, usedMessages: 0 },
      });

      await Promise.all(Array.from({ length: 10 }, () => q.consume(t.id as never)));

      const after = await raw.tenant.findUnique({ where: { id: t.id } });
      // DB yang jadi wasit (WHERE used < quota), bukan kode kita.
      expect(after?.usedMessages).toBe(3);
    });

    it('kuota habis → check() menolak dgn reason MESSAGES', async () => {
      const q = new QuotaPrisma(raw as never);
      const t = await raw.tenant.create({
        data: { name: 'T-Habis', slug: 'tenant-habis', quotaMessages: 1, usedMessages: 1 },
      });

      const d = await q.check(t.id as never);

      expect(d.ok).toBe(true);
      if (d.ok) {
        expect(d.value.allowed).toBe(false);
        expect(d.value.reason).toBe('MESSAGES');
      }
    });

    it('trial kedaluwarsa → ditolak walau kuota pesan masih ada', async () => {
      const q = new QuotaPrisma(raw as never);
      const t = await raw.tenant.create({
        data: {
          name: 'T-Expired',
          slug: 'tenant-expired',
          quotaMessages: 100,
          usedMessages: 0,
          trialEndsAt: new Date(Date.now() - 1000),
        },
      });

      const d = await q.check(t.id as never);

      expect(d.ok && d.value.reason).toBe('TRIAL_EXPIRED');
    });

    it('binding chat → tenant: chat sama tak bisa dipetakan 2x (unique)', async () => {
      const b = new ChannelBindingPrisma(raw as never);
      const t = await raw.tenant.create({ data: { name: 'T-Bind', slug: 'tenant-bind' } });

      await b.bind(t.id as never, 'TELEGRAM', '999');
      const lagi = await b.bind(t.id as never, 'TELEGRAM', '999');

      // Race dua pesan pertama → P2002 diperlakukan sebagai "sudah terikat", bukan error.
      expect(lagi.ok).toBe(true);

      const r = await b.resolve('TELEGRAM', '999');
      expect(r.ok && r.value).toBe(t.id);
    });
  });
});
