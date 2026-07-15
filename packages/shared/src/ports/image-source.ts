// Port: sumber gambar stok (P6) — Unsplash/Pexels di balik satu antarmuka.
//
// Keputusan PO 2026-07-14: slot gambar tanpa foto pelanggan diisi foto stok gratis,
// DI-DOWNLOAD & DI-REHOST ke hosting kita (bukan hotlink — syarat lisensi kedua penyedia
// dan agar situs pelanggan tak bergantung ke CDN pihak ketiga), dengan atribusi tercatat
// di MediaAsset. Foto pelanggan selalu prioritas; stok hanyalah pelengkap.

import type { Port, Result } from '../index.js';

export type ImageSourceErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'UNKNOWN';

export interface ImageSourceError {
  readonly code: ImageSourceErrorCode;
  readonly message: string;
}

export interface StockImage {
  // 'unsplash' | 'pexels' — juga kunci routing trackUsage pada sumber berantai.
  readonly provider: string;
  // Id foto di sisi penyedia. Bersama provider = kunci dedup rehost
  // (MediaAsset.providerFileId = `stock:<provider>:<providerId>`).
  readonly providerId: string;
  // URL file gambar — dipakai SEKALI untuk download+rehost, tak pernah masuk siteDoc.
  readonly imageUrl: string;
  // Halaman foto di situs penyedia (atribusi, syarat lisensi).
  readonly pageUrl: string;
  readonly authorName: string;
  readonly authorUrl: string;
  readonly width: number;
  readonly height: number;
  // Unsplash API guideline: endpoint download_location WAJIB di-GET saat foto benar-benar
  // dipakai (bukan saat search). Pexels tak punya padanan → absen.
  readonly downloadLocation?: string;
}

export interface StockImageSearch {
  // Kueri pencarian — bahasa Inggris (indeks kedua penyedia sangat tipis untuk bahasa
  // Indonesia; "bengkel motor" = 1 hasil, "motorcycle repair workshop" = ratusan).
  readonly query: string;
  readonly perPage?: number;
}

export interface ImageSourcePort extends Port {
  readonly name: 'ImageSource';
  readonly provider: string;
  search(q: StockImageSearch): Promise<Result<readonly StockImage[], ImageSourceError>>;
  // Dipanggil TEPAT saat foto dipakai (setelah rehost sukses). Kegagalan tak boleh
  // menggagalkan build — implementasi menelan error (best-effort, syarat etiket API).
  trackUsage(image: StockImage): Promise<void>;
}
