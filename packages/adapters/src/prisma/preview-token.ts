// Token preview stateless (T-064, FR-PUB-001). token = HMAC-SHA256(secret, revisionId).
// Tak perlu kolom DB / write path saat draft dibuat: URL preview cukup menyertakan token
// hasil `createPreviewToken`; adapter memverifikasi dgn menghitung ulang (timing-safe).
// Revoke global = rotasi `PREVIEW_TOKEN_SECRET`. Cocok utk draft preview ber-noindex.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function createPreviewToken(secret: string, revisionId: string): string {
  return createHmac('sha256', secret).update(revisionId).digest('hex');
}

// True hanya bila token cocok. Perbandingan panjang-tetap (timingSafeEqual) untuk
// menghindari timing oracle; token kosong/panjang beda → false tanpa throw.
export function verifyPreviewToken(secret: string, revisionId: string, token: string): boolean {
  const expected = Buffer.from(createPreviewToken(secret, revisionId));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// Token folder pratinjau PUBLIK (beda dari token preview draft di atas): HMAC(secret,
// "preview:" + websiteId) dipotong 12 hex → nama folder /preview/<slug>-<token>/ yang
// deterministik per website. SATU implementasi (audit 2026-07-16) — dipakai dashboard
// admin, gerbang review, dan worker publish; tiga salinan inline sebelumnya bisa
// menyimpang diam-diam (URL pratinjau yang dijanjikan ≠ folder yang diunggah).
export function createPreviewDirToken(secret: string, websiteId: string): string {
  return createHmac('sha256', secret).update(`preview:${websiteId}`).digest('hex').slice(0, 12);
}
