// P6: tukar isian slot `stock` (kueri karangan LLM) menjadi `image` (URL foto yang sudah
// di-rehost ke hosting kita) SEBELUM materialize. Murni Port — tak kenal Unsplash, Sharp,
// maupun FTP.
//
// Prinsip fail-soft menyeluruh: pencarian gagal, unduhan gagal, kuota tercapai — apa pun
// masalahnya, slot jatuh ke `keep` (gambar bawaan template) dan build TETAP jadi. Gambar
// stok adalah pemanis, bukan alasan pelanggan tak menerima situsnya.
//
// Kenapa rehost (bukan hotlink): syarat lisensi Unsplash/Pexels, dan situs pelanggan tak
// boleh bergantung pada CDN pihak ketiga yang bisa mengubah/menghapus URL. Atribusi
// (provider/pageUrl/author) dicatat di MediaAsset — kewajiban lisensi kedua penyedia.

import { MEDIA_MAX_PER_TENANT } from '@digimaestro/shared';
import type {
  DownloadedMedia,
  ImageSourcePort,
  MediaError,
  MediaProcessorPort,
  MediaRepository,
  MediaStorePort,
  PageFills,
  Result,
  SlotFill,
  StockImage,
  TenantId,
} from '@digimaestro/shared';

export interface ResolveSlotImagesDeps {
  readonly source: ImageSourcePort;
  // Unduh file gambar dari URL penyedia (adapter HTTP; kontrak sama dgn unduhan Telegram).
  readonly download: (url: string) => Promise<Result<DownloadedMedia, MediaError>>;
  readonly processor: MediaProcessorPort;
  readonly store: MediaStorePort;
  readonly media: MediaRepository;
  // Nama file content-addressed — di-inject agar core tak memilih algoritma hash (pola
  // ingest-media).
  readonly filename: (bytes: Uint8Array, contentType: string) => string;
  readonly logger?: { warn(msg: string): void };
  // Pagar biaya & rate limit per BUILD (Unsplash demo = 50 req/jam). Slot stock setelah
  // batas → keep. Default 12: cukup untuk galeri satu situs UMKM.
  readonly maxPerBuild?: number;
  readonly maxPerTenant?: number;
}

export const DEFAULT_STOCK_MAX_PER_BUILD = 12;

// Kunci dedup di MediaAsset.providerFileId — foto stok yang sama tak diunduh dua kali
// untuk tenant yang sama (kolom sudah unik per (tenantId, providerFileId)).
export function stockProviderFileId(image: StockImage): string {
  return `stock:${image.provider}:${image.providerId}`;
}

export async function resolveSlotImages(
  deps: ResolveSlotImagesDeps,
  tenantId: TenantId,
  pages: readonly PageFills[],
): Promise<readonly PageFills[]> {
  const maxPerBuild = deps.maxPerBuild ?? DEFAULT_STOCK_MAX_PER_BUILD;
  // Satu kueri dicari SEKALI per build; slot berikutnya dengan kueri sama mengambil hasil
  // berikutnya (kursor) — galeri tak berisi foto kembar.
  const searchCache = new Map<string, { images: readonly StockImage[]; cursor: number }>();
  let resolved = 0;

  const out: PageFills[] = [];
  for (const page of pages) {
    const fills: Record<string, SlotFill> = {};
    for (const [editId, fill] of Object.entries(page.fills)) {
      if (fill.kind !== 'stock') {
        fills[editId] = fill;
        continue;
      }
      if (resolved >= maxPerBuild) {
        fills[editId] = { kind: 'keep' };
        continue;
      }
      const image = await nextImage(deps, searchCache, fill.query);
      if (!image) {
        fills[editId] = { kind: 'keep' };
        continue;
      }
      const url = await rehost(deps, tenantId, image);
      if (!url) {
        fills[editId] = { kind: 'keep' };
        continue;
      }
      resolved += 1;
      fills[editId] = { kind: 'image', url, alt: fill.alt };
    }
    out.push({ slug: page.slug, ...(page.title ? { title: page.title } : {}), fills });
  }
  return out;
}

async function nextImage(
  deps: ResolveSlotImagesDeps,
  cache: Map<string, { images: readonly StockImage[]; cursor: number }>,
  query: string,
): Promise<StockImage | null> {
  const key = query.trim().toLowerCase();
  let entry = cache.get(key);
  if (!entry) {
    const res = await deps.source.search({ query, perPage: 10 });
    if (!res.ok) {
      deps.logger?.warn(`[stock] pencarian "${query}" gagal (${res.error.code}): ${res.error.message}`);
      entry = { images: [], cursor: 0 };
    } else {
      entry = { images: res.value, cursor: 0 };
    }
    cache.set(key, entry);
  }
  if (entry.images.length === 0) return null;
  const image = entry.images[entry.cursor % entry.images.length] ?? null;
  entry.cursor += 1;
  return image;
}

// Unduh → optimasi → simpan → catat MediaAsset (+atribusi). Mengembalikan URL publik,
// atau null bila gagal di titik mana pun. Dedup: foto yang sama untuk tenant yang sama
// memakai baris MediaAsset yang ada (tanpa unduh ulang).
async function rehost(
  deps: ResolveSlotImagesDeps,
  tenantId: TenantId,
  image: StockImage,
): Promise<string | null> {
  const fileId = stockProviderFileId(image);

  const existing = await deps.media.findByProviderFileId(tenantId, fileId);
  if (existing.ok && existing.value) return existing.value.url;

  // Kuota media tenant berlaku juga untuk foto stok (pagar kuota hosting shared, P1 audit).
  const quota = deps.maxPerTenant ?? MEDIA_MAX_PER_TENANT;
  const all = await deps.media.findMany(tenantId);
  if (!all.ok || all.value.length >= quota) {
    if (all.ok) deps.logger?.warn(`[stock] kuota media tenant tercapai (${all.value.length}/${quota})`);
    return null;
  }

  const downloaded = await deps.download(image.imageUrl);
  if (!downloaded.ok) {
    deps.logger?.warn(`[stock] unduh ${image.provider}:${image.providerId} gagal: ${downloaded.error.message}`);
    return null;
  }
  const optimized = await deps.processor.optimize(downloaded.value);
  if (!optimized.ok) {
    deps.logger?.warn(`[stock] optimasi ${image.provider}:${image.providerId} gagal: ${optimized.error.message}`);
    return null;
  }
  const stored = await deps.store.store({
    tenantId,
    filename: deps.filename(optimized.value.bytes, optimized.value.contentType),
    bytes: optimized.value.bytes,
    contentType: optimized.value.contentType,
  });
  if (!stored.ok) {
    deps.logger?.warn(`[stock] simpan ${image.provider}:${image.providerId} gagal: ${stored.error.message}`);
    return null;
  }

  const created = await deps.media.create(tenantId, {
    providerFileId: fileId,
    storageKey: stored.value.key,
    url: stored.value.url,
    contentType: optimized.value.contentType,
    width: optimized.value.width,
    height: optimized.value.height,
    sizeBytes: optimized.value.bytes.byteLength,
    sourceProvider: image.provider,
    sourceUrl: image.pageUrl,
    authorName: image.authorName,
    authorUrl: image.authorUrl,
  });
  if (!created.ok) {
    // CONFLICT = build paralel menang duluan → pakai baris yang ada.
    if (created.error.code === 'CONFLICT') {
      const again = await deps.media.findByProviderFileId(tenantId, fileId);
      if (again.ok && again.value) return again.value.url;
    }
    deps.logger?.warn(`[stock] catat MediaAsset gagal: ${created.error.message}`);
    return null;
  }

  // Syarat etiket Unsplash: sinyal "foto dipakai" — best-effort, SETELAH rehost sukses.
  await deps.source.trackUsage(image).catch(() => undefined);

  return created.value.url;
}
