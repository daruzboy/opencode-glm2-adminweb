import { describe, expect, it, vi } from 'vitest';
import { ok, err, tenantId } from '@digimaestro/shared';
import { ingestMedia, type IngestMediaDeps } from './ingest-media.js';

const TENANT = tenantId('t1');
const REF = 'tg-file-abc';

function asset(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    tenantId: 't1',
    providerFileId: REF,
    storageKey: 'media/t1/hash.webp',
    url: 'https://digimaestro.id/media/t1/hash.webp',
    contentType: 'image/webp',
    width: 1600,
    height: 1200,
    sizeBytes: 90_000,
    createdAt: '',
    ...over,
  };
}

function fakeDeps(over: Record<string, unknown> = {}) {
  const download = (over.download as never) ?? {
    download: vi.fn(async () => ok({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' })),
  };
  const processor = (over.processor as never) ?? {
    optimize: vi.fn(async () => ok({
      bytes: new Uint8Array([9, 9]),
      contentType: 'image/webp',
      width: 1600,
      height: 1200,
    })),
  };
  const store = (over.store as never) ?? {
    store: vi.fn(async () => ok({ key: 'media/t1/hash.webp', url: 'https://digimaestro.id/media/t1/hash.webp' })),
  };
  const media = (over.media as never) ?? {
    findByProviderFileId: vi.fn(async () => ok(null)),
    findMany: vi.fn(async () => ok([])),
    create: vi.fn(async () => ok(asset())),
  };
  return { download, processor, store, media, filename: () => 'hash.webp' } as unknown as IngestMediaDeps;
}

describe('ingestMedia — jalur bahagia', () => {
  it('unduh → optimasi → simpan → catat, mengembalikan URL publik', async () => {
    const deps = fakeDeps();
    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.deduped).toBe(false);
      expect(res.value.asset.url).toBe('https://digimaestro.id/media/t1/hash.webp');
    }
    // Ukuran yang dicatat = ukuran SETELAH optimasi (bukan foto mentah).
    expect(deps.media.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ contentType: 'image/webp', sizeBytes: 2, width: 1600 }),
    );
  });

  it('media disimpan tenant-scoped (NFR-09)', async () => {
    const deps = fakeDeps();
    await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(deps.store.store).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }));
  });
});

// Pelanggan sering mengirim ulang foto yang sama. Mengunduh + memproses ulang membuang
// bandwidth, CPU, dan kuota hosting.
describe('ingestMedia — dedup', () => {
  it('foto sudah pernah masuk → TIDAK diunduh & TIDAK diproses ulang', async () => {
    const media = {
      findByProviderFileId: vi.fn(async () => ok(asset())),
      findMany: vi.fn(async () => ok([])),
      create: vi.fn(),
    };
    const deps = fakeDeps({ media });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(res.ok && res.value.deduped).toBe(true);
    expect(deps.download.download).not.toHaveBeenCalled();
    expect(deps.processor.optimize).not.toHaveBeenCalled();
    expect(media.create).not.toHaveBeenCalled();
  });

  // Dua worker memproses pesan yang sama bersamaan → yang kalah kena unique constraint.
  // Itu bukan kegagalan: ambil baris yang sudah ada (constraint DB = sumber kebenaran).
  it('race: CONFLICT saat create → pakai baris yang sudah ada, bukan error', async () => {
    let seen = false;
    const media = {
      findByProviderFileId: vi.fn(async () => {
        const res = seen ? ok(asset()) : ok(null);
        seen = true;
        return res;
      }),
      findMany: vi.fn(async () => ok([])),
      create: vi.fn(async () => err({ code: 'CONFLICT' as const, message: 'sudah ada' })),
    };
    const res = await ingestMedia(fakeDeps({ media }), { tenantId: TENANT, mediaRef: REF });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.deduped).toBe(true);
  });
});

describe('ingestMedia — kegagalan tiap lapis', () => {
  it('unduh gagal → err DOWNLOAD, tak menyimpan apa pun', async () => {
    const download = { download: vi.fn(async () => err({ code: 'DOWNLOAD' as const, message: 'timeout' })) };
    const deps = fakeDeps({ download });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('DOWNLOAD');
    expect(deps.store.store).not.toHaveBeenCalled();
    expect(deps.media.create).not.toHaveBeenCalled();
  });

  // File bukan gambar / rusak → jangan simpan sampah ke hosting.
  it('optimasi gagal → err PROCESS, tak menyimpan', async () => {
    const processor = { optimize: vi.fn(async () => err({ code: 'PROCESS' as const, message: 'bukan gambar' })) };
    const deps = fakeDeps({ processor });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PROCESS');
    expect(deps.store.store).not.toHaveBeenCalled();
  });

  // Upload gagal → JANGAN catat MediaAsset: barisnya akan menunjuk URL yang 404.
  it('simpan gagal → err STORE, TIDAK mencatat MediaAsset', async () => {
    const store = { store: vi.fn(async () => err({ code: 'STORE' as const, message: 'ftp putus' })) };
    const deps = fakeDeps({ store });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: REF });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('STORE');
    expect(deps.media.create).not.toHaveBeenCalled();
  });
});

// P1 (audit): tanpa kuota, SATU tenant bisa memenuhi kuota hosting shared yang dipakai
// bersama SEMUA situs klien — dan tak ada jalur penghapusan.
describe('ingestMedia — kuota per tenant', () => {
  function penuh(n: number) {
    return {
      findByProviderFileId: vi.fn(async () => ok(null)),
      findMany: vi.fn(async () => ok(Array.from({ length: n }, () => asset()))),
      create: vi.fn(async () => ok(asset())),
    };
  }

  it('kuota tercapai → err QUOTA, TANPA mengunduh/memproses/menyimpan', async () => {
    const deps = fakeDeps({ media: penuh(50) });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: 'baru' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('QUOTA');
    // Percuma menarik & memproses foto yang memang tak akan disimpan.
    expect(deps.download.download).not.toHaveBeenCalled();
    expect(deps.processor.optimize).not.toHaveBeenCalled();
    expect(deps.store.store).not.toHaveBeenCalled();
  });

  it('di bawah kuota → jalan normal', async () => {
    const deps = fakeDeps({ media: penuh(10) });

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: 'baru' });

    expect(res.ok).toBe(true);
    expect(deps.download.download).toHaveBeenCalled();
  });

  it('kuota bisa dikonfigurasi', async () => {
    const deps = fakeDeps({ media: penuh(3) });
    (deps as { maxPerTenant?: number }).maxPerTenant = 3;

    const res = await ingestMedia(deps, { tenantId: TENANT, mediaRef: 'baru' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('QUOTA');
  });
});
