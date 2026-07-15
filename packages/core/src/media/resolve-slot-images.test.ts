// P6: resolveSlotImages — isian `stock` → `image` (rehost) / `keep` (fail-soft).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import { resolveSlotImages, stockProviderFileId } from './resolve-slot-images.js';
import type {
  ImageSourcePort,
  MediaAssetEntity,
  MediaRepository,
  PageFills,
  StockImage,
  TenantId,
} from '@digimaestro/shared';
import type { ResolveSlotImagesDeps } from './resolve-slot-images.js';

const TID = tenantId('t1');

function image(id: string, provider = 'unsplash'): StockImage {
  return {
    provider,
    providerId: id,
    imageUrl: `https://cdn.example/${id}.jpg`,
    pageUrl: `https://unsplash.com/photos/${id}`,
    authorName: 'Jane Doe',
    authorUrl: 'https://unsplash.com/@jane',
    width: 4000,
    height: 3000,
  };
}

function fakeMediaRepo(existing: MediaAssetEntity[] = []): MediaRepository & { created: unknown[] } {
  const rows = [...existing];
  const created: unknown[] = [];
  return {
    name: 'MediaRepository',
    created,
    async findByProviderFileId(_t: TenantId, fileId: string) {
      return ok(rows.find((r) => r.providerFileId === fileId) ?? null);
    },
    async findMany() {
      return ok([...rows]);
    },
    async create(_t: TenantId, input) {
      created.push(input);
      const row: MediaAssetEntity = {
        id: `m${rows.length + 1}`,
        tenantId: 't1',
        createdAt: '2026-07-15T00:00:00Z',
        ...input,
      } as MediaAssetEntity;
      rows.push(row);
      return ok(row);
    },
  };
}

function deps(overrides: Partial<ResolveSlotImagesDeps> = {}): ResolveSlotImagesDeps & {
  source: ImageSourcePort & { trackUsage: ReturnType<typeof vi.fn> };
  media: ReturnType<typeof fakeMediaRepo>;
} {
  const source = {
    name: 'ImageSource' as const,
    provider: 'unsplash',
    search: vi.fn(async () => ok([image('a1'), image('a2')])),
    trackUsage: vi.fn(async () => undefined),
  };
  const media = fakeMediaRepo();
  return {
    source,
    download: vi.fn(async () => ok({ bytes: new Uint8Array([1]), contentType: 'image/jpeg' })),
    processor: {
      optimize: vi.fn(async () => ok({ bytes: new Uint8Array([2]), contentType: 'image/webp', width: 1600, height: 1200 })),
    },
    store: {
      store: vi.fn(async (input: { filename: string }) =>
        ok({ key: `media/t1/${input.filename}`, url: `https://digimaestro.id/media/t1/${input.filename}` }),
      ),
    },
    media,
    filename: () => 'foto.webp',
    ...overrides,
  } as never;
}

function pages(fills: Record<string, PageFills['fills'][string]>): PageFills[] {
  return [{ slug: 'home', fills }];
}

describe('resolveSlotImages', () => {
  it('stock → image dengan URL rehost; atribusi tercatat; trackUsage dipanggil', async () => {
    const d = deps();
    const out = await resolveSlotImages(d, TID, pages({ s1: { kind: 'stock', query: 'coffee shop', alt: 'kedai kopi' } }));

    const fill = out[0]?.fills.s1;
    expect(fill?.kind).toBe('image');
    if (fill?.kind === 'image') {
      expect(fill.url).toBe('https://digimaestro.id/media/t1/foto.webp');
      expect(fill.alt).toBe('kedai kopi');
    }
    expect(d.media.created[0]).toMatchObject({
      providerFileId: 'stock:unsplash:a1',
      sourceProvider: 'unsplash',
      authorName: 'Jane Doe',
    });
    expect(d.source.trackUsage).toHaveBeenCalledOnce();
  });

  it('isian non-stock lolos apa adanya', async () => {
    const d = deps();
    const out = await resolveSlotImages(
      d,
      TID,
      pages({
        t1: { kind: 'text', text: 'Halo' },
        i1: { kind: 'image', url: 'https://digimaestro.id/media/t1/user.webp', alt: 'foto' },
      }),
    );
    expect(out[0]?.fills.t1).toEqual({ kind: 'text', text: 'Halo' });
    expect(out[0]?.fills.i1).toMatchObject({ kind: 'image' });
    expect(d.source.search as never).not.toHaveBeenCalled();
  });

  it('pencarian gagal / kosong / unduhan gagal → keep (build tak pernah gagal)', async () => {
    const failSearch = deps();
    (failSearch.source.search as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'RATE_LIMIT', message: 'limit' }),
    );
    const r1 = await resolveSlotImages(failSearch, TID, pages({ s1: { kind: 'stock', query: 'x', alt: 'a' } }));
    expect(r1[0]?.fills.s1).toEqual({ kind: 'keep' });

    const empty = deps();
    (empty.source.search as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]));
    const r2 = await resolveSlotImages(empty, TID, pages({ s1: { kind: 'stock', query: 'x', alt: 'a' } }));
    expect(r2[0]?.fills.s1).toEqual({ kind: 'keep' });

    const failDl = deps({ download: vi.fn(async () => err({ code: 'DOWNLOAD', message: 'putus' })) as never });
    const r3 = await resolveSlotImages(failDl, TID, pages({ s1: { kind: 'stock', query: 'x', alt: 'a' } }));
    expect(r3[0]?.fills.s1).toEqual({ kind: 'keep' });
  });

  it('kueri sama dua slot → SATU pencarian, foto BERBEDA (kursor); dedup rehost per foto', async () => {
    const d = deps();
    const out = await resolveSlotImages(
      d,
      TID,
      pages({
        s1: { kind: 'stock', query: 'Coffee Shop', alt: 'a' },
        s2: { kind: 'stock', query: 'coffee shop', alt: 'b' },
      }),
    );
    expect(d.source.search as never).toHaveBeenCalledOnce();
    // a1 utk slot pertama, a2 utk slot kedua → dua baris MediaAsset berbeda.
    expect(d.media.created).toHaveLength(2);
    expect((d.media.created[0] as { providerFileId: string }).providerFileId).toBe('stock:unsplash:a1');
    expect((d.media.created[1] as { providerFileId: string }).providerFileId).toBe('stock:unsplash:a2');
    expect(out[0]?.fills.s1).not.toEqual(out[0]?.fills.s2);
  });

  it('foto sudah pernah di-rehost tenant ini → pakai URL lama tanpa unduh ulang', async () => {
    const existing: MediaAssetEntity = {
      id: 'm0',
      tenantId: 't1',
      providerFileId: stockProviderFileId(image('a1')),
      storageKey: 'media/t1/lama.webp',
      url: 'https://digimaestro.id/media/t1/lama.webp',
      contentType: 'image/webp',
      width: 1600,
      height: 1200,
      sizeBytes: 100,
      createdAt: '2026-07-14T00:00:00Z',
    };
    const d = deps({ media: fakeMediaRepo([existing]) as never });
    const out = await resolveSlotImages(d, TID, pages({ s1: { kind: 'stock', query: 'x', alt: 'a' } }));
    const fill = out[0]?.fills.s1;
    expect(fill?.kind === 'image' && fill.url).toBe('https://digimaestro.id/media/t1/lama.webp');
    expect(d.download as never).not.toHaveBeenCalled();
  });

  it('maxPerBuild membatasi jumlah foto stok per build; sisanya keep', async () => {
    const d = deps({ maxPerBuild: 1 });
    const out = await resolveSlotImages(
      d,
      TID,
      pages({
        s1: { kind: 'stock', query: 'a', alt: 'a' },
        s2: { kind: 'stock', query: 'b', alt: 'b' },
      }),
    );
    const kinds = [out[0]?.fills.s1?.kind, out[0]?.fills.s2?.kind].sort();
    expect(kinds).toEqual(['image', 'keep']);
  });

  it('kuota media tenant tercapai → keep (pagar hosting shared)', async () => {
    const d = deps({ maxPerTenant: 0 });
    const out = await resolveSlotImages(d, TID, pages({ s1: { kind: 'stock', query: 'x', alt: 'a' } }));
    expect(out[0]?.fills.s1).toEqual({ kind: 'keep' });
    expect(d.download as never).not.toHaveBeenCalled();
  });
});
