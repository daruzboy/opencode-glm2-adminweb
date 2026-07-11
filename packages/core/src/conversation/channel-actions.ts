// T-031tg: aksi tombol interaktif (FR-CHN-002; approval-first BRU-02).
//
// callback_data datang DARI LUAR (pengguna bisa mengarang payload lewat Bot API), jadi
// diperlakukan seperti input tepi lain: diparse ketat ke bentuk tertutup, lalu argumennya
// TETAP divalidasi ulang terhadap DB milik tenant sebelum dipakai. Tidak ada websiteId di
// sini — satu website per tenant (BRU-01), jadi tenant sudah menentukan website-nya, dan
// pengguna tak bisa menunjuk website tenant lain lewat tombol.
//
// Bentuk `<verb>:<arg>` supaya muat di batas 64 byte callback_data Telegram.

export type ChannelAction =
  // Setujui & publikasikan revisi ke-n (persetujuan eksplisit klien, BRU-02).
  | { readonly kind: 'publish'; readonly revisionNumber: number }
  // Minta perubahan pada revisi ke-n → percakapan lanjut ke agent.
  | { readonly kind: 'revise'; readonly revisionNumber: number };

export const ACTION_PUBLISH_PREFIX = 'pub';
export const ACTION_REVISE_PREFIX = 'rev';

export function encodeChannelAction(action: ChannelAction): string {
  const prefix = action.kind === 'publish' ? ACTION_PUBLISH_PREFIX : ACTION_REVISE_PREFIX;
  return `${prefix}:${action.revisionNumber}`;
}

// null = tidak dikenali. Nomor revisi wajib bilangan bulat positif — string apa pun yang
// tak lolos ditolak, bukan dipaksa jadi NaN/0 lalu dipakai untuk query.
export function parseChannelAction(raw: string | undefined): ChannelAction | null {
  if (!raw) return null;
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;

  const verb = raw.slice(0, sep);
  const arg = raw.slice(sep + 1);
  if (!/^[1-9][0-9]*$/.test(arg)) return null;
  const revisionNumber = Number(arg);

  if (verb === ACTION_PUBLISH_PREFIX) return { kind: 'publish', revisionNumber };
  if (verb === ACTION_REVISE_PREFIX) return { kind: 'revise', revisionNumber };
  return null;
}
