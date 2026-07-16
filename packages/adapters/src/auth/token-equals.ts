// Perbandingan token statis konstan-waktu (audit 2026-07-16). Sebelumnya tiga salinan
// lokal (dashboard admin, callback review, webhook Telegram) — logika keamanan yang
// diduplikasi cepat menyimpang. Panjang beda → langsung false (timingSafeEqual melempar
// bila panjang buffer tak sama); string kosong/bukan-string → false tanpa throw.

import { timingSafeEqual } from 'node:crypto';

export function secureTokenEquals(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
