// Port: media masuk dari kanal (T-033; FR-MED-001/002).
//
// Alur: pelanggan kirim foto di chat → unduh dari penyedia kanal → optimasi (resize+WebP)
// → simpan ke storage publik → catat MediaAsset (tenant-scoped) → agent bisa memakainya
// di galeri situs.
//
// Semua vendor berhenti di adapter: core tak kenal Telegram, sharp, maupun FTP.

import type { RepositoryError } from './repository.js';
import type { Result, TenantId } from '../index.js';

export type MediaErrorCode =
  | 'DOWNLOAD'
  | 'PROCESS'
  | 'STORE'
  | 'TOO_LARGE'
  | 'UNSUPPORTED'
  // P1 (audit): tenant melewati kuota foto. Tanpa batas, SATU tenant bisa memenuhi kuota
  // hosting shared (dipakai bersama semua situs klien) — dan tak ada jalur penghapusan.
  | 'QUOTA';

export interface MediaError {
  readonly code: MediaErrorCode;
  readonly message: string;
}

// Batas unduhan. Foto Telegram jauh di bawah ini; batas ada supaya file raksasa tak
// menghabiskan memori worker (kita menahan seluruh isi di memori saat memproses).
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

// Maksimum foto tersimpan per tenant. Galeri situs UMKM realistis memakai belasan foto;
// 50 memberi ruang lega tanpa membiarkan satu tenant menguras kuota hosting bersama.
export const MEDIA_MAX_PER_TENANT = 50;

export interface DownloadedMedia {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

// Unduh media dari penyedia kanal (Telegram file_id → bytes).
export interface MediaDownloadPort {
  download(mediaRef: string): Promise<Result<DownloadedMedia, MediaError>>;
}

export interface OptimizedMedia {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

// Optimasi gambar (FR-MED-002): resize + format hemat (WebP). Deterministik & tanpa I/O
// jaringan — dipisah dari download/store agar tiap lapis bisa diuji sendiri.
export interface MediaProcessorPort {
  optimize(input: DownloadedMedia): Promise<Result<OptimizedMedia, MediaError>>;
}

export interface StoredMedia {
  // Path relatif di storage (kunci arsip).
  readonly key: string;
  // URL PUBLIK — wajib bisa diakses pengunjung situs, karena galeri merender <img src>.
  readonly url: string;
}

// Simpan media & kembalikan URL publik.
//
// PENTING: media TIDAK boleh tinggal di docroot situs. Deploy publish adalah mirror penuh
// (upload + hapus file usang), jadi apa pun di dalam docroot situs akan TERHAPUS pada
// publish berikutnya — foto pelanggan ikut lenyap. Adapter menaruhnya di ruang terpisah
// per tenant (mis. `media/<tenantId>/`) yang tak tersentuh mirror.
export interface MediaStorePort {
  store(input: {
    readonly tenantId: TenantId;
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<Result<StoredMedia, MediaError>>;
}

// ── Entity & repository ───────────────────────────────────────────────────────

export interface MediaAssetEntity {
  readonly id: string;
  readonly tenantId: string;
  // Id file di sisi penyedia (Telegram file_id) → dedup: foto yang sama tak diunduh 2×.
  readonly providerFileId: string;
  readonly storageKey: string;
  readonly url: string;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  // P6 (gambar stok): atribusi WAJIB tercatat saat foto berasal dari Unsplash/Pexels
  // (syarat lisensi; foto di-rehost, bukan hotlink). Null/absen = foto kiriman pelanggan.
  readonly sourceProvider?: string | null;
  readonly sourceUrl?: string | null;
  readonly authorName?: string | null;
  readonly authorUrl?: string | null;
  readonly createdAt: string;
}

export interface MediaAssetCreateInput {
  readonly providerFileId: string;
  readonly storageKey: string;
  readonly url: string;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  // P6: atribusi foto stok (lihat MediaAssetEntity).
  readonly sourceProvider?: string;
  readonly sourceUrl?: string;
  readonly authorName?: string;
  readonly authorUrl?: string;
}

export interface MediaRepository {
  readonly name: 'MediaRepository';
  findByProviderFileId(
    tenantId: TenantId,
    providerFileId: string,
  ): Promise<Result<MediaAssetEntity | null, RepositoryError>>;
  findMany(tenantId: TenantId): Promise<Result<MediaAssetEntity[], RepositoryError>>;
  create(
    tenantId: TenantId,
    input: MediaAssetCreateInput,
  ): Promise<Result<MediaAssetEntity, RepositoryError>>;
}
