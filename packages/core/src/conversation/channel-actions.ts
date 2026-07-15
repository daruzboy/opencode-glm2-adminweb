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
  // tenantHint (konsol admin 2026-07-15): sidik tenant pemilik tombol — chat admin bisa
  // BERGANTI konsumen antara tombol terkirim dan tombol ditekan; tanpa sidik, revisi
  // nomor sama milik konsumen LAIN bisa ikut terbit. Absen = tombol lama (kompat).
  | { readonly kind: 'publish'; readonly revisionNumber: number; readonly tenantHint?: string }
  // Minta perubahan pada revisi ke-n → percakapan lanjut ke agent.
  | { readonly kind: 'revise'; readonly revisionNumber: number; readonly tenantHint?: string };

export const ACTION_PUBLISH_PREFIX = 'pub';
export const ACTION_REVISE_PREFIX = 'rev';
// Panjang sidik tenant di callback_data (batas total 64 byte; cuid 8 char = cukup unik
// utk MEMBEDAKAN, bukan utk autentikasi — validasi sesungguhnya tetap query tenant-scoped).
export const TENANT_HINT_LENGTH = 8;

export function tenantHintOf(tenantId: string): string {
  return tenantId.slice(0, TENANT_HINT_LENGTH);
}

export function encodeChannelAction(action: ChannelAction): string {
  const prefix = action.kind === 'publish' ? ACTION_PUBLISH_PREFIX : ACTION_REVISE_PREFIX;
  const hint = action.tenantHint ? `:${action.tenantHint}` : '';
  return `${prefix}:${action.revisionNumber}${hint}`;
}

// null = tidak dikenali. Nomor revisi wajib bilangan bulat positif — string apa pun yang
// tak lolos ditolak, bukan dipaksa jadi NaN/0 lalu dipakai untuk query.
export function parseChannelAction(raw: string | undefined): ChannelAction | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const [verb, arg, hint] = parts;
  if (!arg || !/^[1-9][0-9]*$/.test(arg)) return null;
  const revisionNumber = Number(arg);
  if (hint !== undefined && !/^[a-z0-9]{2,16}$/i.test(hint)) return null;
  const withHint = hint ? { tenantHint: hint } : {};

  if (verb === ACTION_PUBLISH_PREFIX) return { kind: 'publish', revisionNumber, ...withHint };
  if (verb === ACTION_REVISE_PREFIX) return { kind: 'revise', revisionNumber, ...withHint };
  return null;
}
