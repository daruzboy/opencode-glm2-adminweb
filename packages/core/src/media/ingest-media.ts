// T-033: use case terima media dari chat (FR-MED-001/002). Murni Port — tak kenal
// Telegram, sharp, maupun FTP.
//
// Alur: dedup → unduh → optimasi (resize + WebP) → simpan (URL publik) → catat MediaAsset.
//
// Dedup di depan penting bukan sekadar demi kerapian: mengunduh + memproses ulang foto
// yang sama membuang bandwidth, CPU worker, dan kuota hosting. Pelanggan sering mengirim
// ulang foto yang sama, dan Telegram memberi file_id yang stabil untuk itu.

import { err, ok } from '@digimaestro/shared';
import type {
  MediaAssetEntity,
  MediaDownloadPort,
  MediaError,
  MediaProcessorPort,
  MediaRepository,
  MediaStorePort,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface IngestMediaDeps {
  readonly download: MediaDownloadPort;
  readonly processor: MediaProcessorPort;
  readonly store: MediaStorePort;
  readonly media: MediaRepository;
  // Nama file dari isi (content-addressed) — di-inject agar core tak memilih algoritma hash.
  readonly filename: (bytes: Uint8Array, contentType: string) => string;
}

export interface IngestMediaRequest {
  readonly tenantId: TenantId;
  // file_id penyedia kanal (Telegram).
  readonly mediaRef: string;
}

export interface IngestMediaResult {
  readonly asset: MediaAssetEntity;
  // true → sudah pernah diterima; tak ada unduhan/pemrosesan ulang.
  readonly deduped: boolean;
}

export type IngestError = MediaError | RepositoryError;

export async function ingestMedia(
  deps: IngestMediaDeps,
  req: IngestMediaRequest,
): Promise<Result<IngestMediaResult, IngestError>> {
  // 1) Sudah pernah? → pakai yang lama.
  const existing = await deps.media.findByProviderFileId(req.tenantId, req.mediaRef);
  if (!existing.ok) return err(existing.error);
  if (existing.value) return ok({ asset: existing.value, deduped: true });

  // 2) Unduh dari kanal.
  const downloaded = await deps.download.download(req.mediaRef);
  if (!downloaded.ok) return err(downloaded.error);

  // 3) Optimasi (FR-MED-002): foto ponsel 4000px/5MB → WebP ≤1600px.
  const optimized = await deps.processor.optimize(downloaded.value);
  if (!optimized.ok) return err(optimized.error);

  // 4) Simpan → URL publik (dipakai <img src> galeri).
  const filename = deps.filename(optimized.value.bytes, optimized.value.contentType);
  const stored = await deps.store.store({
    tenantId: req.tenantId,
    filename,
    bytes: optimized.value.bytes,
    contentType: optimized.value.contentType,
  });
  if (!stored.ok) return err(stored.error);

  // 5) Catat (tenant-scoped).
  const created = await deps.media.create(req.tenantId, {
    providerFileId: req.mediaRef,
    storageKey: stored.value.key,
    url: stored.value.url,
    contentType: optimized.value.contentType,
    width: optimized.value.width,
    height: optimized.value.height,
    sizeBytes: optimized.value.bytes.byteLength,
  });

  if (!created.ok) {
    // CONFLICT = pesan yang sama diproses paralel (dua worker) dan yang lain menang duluan.
    // Bukan kegagalan: ambil baris yang sudah ada. Constraint DB = sumber kebenaran.
    if (created.error.code === 'CONFLICT') {
      const again = await deps.media.findByProviderFileId(req.tenantId, req.mediaRef);
      if (again.ok && again.value) return ok({ asset: again.value, deduped: true });
    }
    return err(created.error);
  }

  return ok({ asset: created.value, deduped: false });
}
