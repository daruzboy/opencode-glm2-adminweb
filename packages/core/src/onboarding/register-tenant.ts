// Self-serve onboarding (langkah #6). Chat yang belum dikenal → daftar dengan KODE UNDANGAN.
//
// TIDAK memanggil LLM sama sekali. Ini penting: jalur pendaftaran adalah pintu yang terbuka
// bagi siapa pun yang menemukan bot. Kalau ia memanggil LLM, orang iseng bisa membakar token
// hanya dengan mengirim pesan acak — persis lubang yang gerbang ini seharusnya tutup.

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelBindingPort,
  ConversationChannel,
  InviteCodePort,
  RepositoryError,
  Result,
  TenantId,
  TenantProvisionPort,
} from '@digimaestro/shared';

export interface RegisterDeps {
  readonly invites: InviteCodePort;
  readonly bindings: ChannelBindingPort;
  readonly tenants: TenantProvisionPort;
  // Kuota trial (keputusan PO 2026-07-12: 100 pesan · 1 situs · 14 hari).
  readonly quotaMessages: number;
  readonly quotaWebsites: number;
  readonly trialDays: number;
  // Nama slug dari nama chat; di-inject agar core tak memilih algoritma.
  readonly slugify: (name: string) => string;
}

export interface RegisterRequest {
  readonly channel: ConversationChannel;
  readonly externalId: string;
  readonly text: string;
  readonly senderName?: string;
}

export type RegisterOutcome =
  // Berhasil daftar → chat kini terikat ke tenant baru.
  | { readonly kind: 'registered'; readonly tenantId: TenantId }
  // Pesan bukan upaya daftar (mis. "halo") → beri instruksi, jangan panggil LLM.
  | { readonly kind: 'needs_code' }
  | { readonly kind: 'invalid_code'; readonly reason: string };

// Menerima "/daftar KODE", "daftar KODE", atau kode telanjang. Sengaja longgar: pelanggan
// UMKM tak akan hafal sintaks perintah, dan menolak mereka karena format = kehilangan
// pelanggan sungguhan.
export function parseInviteCode(text: string): string | null {
  const bersih = text.trim();
  const m = bersih.match(/^\/?daftar\s+([A-Za-z0-9_-]{4,32})$/i);
  if (m?.[1]) return m[1];

  // Kode telanjang (pelanggan sering hanya menempelkan kodenya).
  if (/^[A-Za-z0-9_-]{4,32}$/.test(bersih) && /[0-9]/.test(bersih)) return bersih;
  return null;
}

export async function registerFromInvite(
  deps: RegisterDeps,
  req: RegisterRequest,
): Promise<Result<RegisterOutcome, RepositoryError>> {
  const code = parseInviteCode(req.text);
  if (!code) return ok({ kind: 'needs_code' });

  // Penukaran ATOMIK (increment bersyarat) → dua pendaftar bersamaan tak bisa menembus maxUses.
  const redeemed = await deps.invites.redeem(code);
  if (!redeemed.ok) {
    const alasan =
      redeemed.error.code === 'EXPIRED'
        ? 'Kode undangannya sudah kedaluwarsa.'
        : redeemed.error.code === 'EXHAUSTED'
          ? 'Kode undangannya sudah habis dipakai.'
          : 'Kode undangannya tidak dikenali.';
    return ok({ kind: 'invalid_code', reason: alasan });
  }

  const nama = req.senderName?.trim() || 'Usaha Baru';
  const created = await deps.tenants.create({
    name: nama,
    slug: deps.slugify(nama),
    inviteCodeId: redeemed.value.id,
    quotaMessages: deps.quotaMessages,
    quotaWebsites: deps.quotaWebsites,
    trialDays: deps.trialDays,
  });
  if (!created.ok) return err(created.error);

  // Ikat chat → tenant. Bila ini gagal, tenant terlanjur ada tapi chat tak terhubung →
  // pengguna akan mencoba mendaftar lagi & kode terpakai sia-sia. Karena itu kegagalan di
  // sini dikembalikan sebagai error (bukan ditelan): PO akan melihatnya lewat alert.
  const bound = await deps.bindings.bind(created.value, req.channel, req.externalId);
  if (!bound.ok) return err(bound.error);

  return ok({ kind: 'registered', tenantId: created.value });
}

// ── Balasan (persona Indonesia santai-profesional, PRD) ───────────────────────

export function needsCodeReply(): string {
  return (
    'Halo! 👋 Aku asisten pembuat website untuk UMKM.\n\n' +
    'Untuk mulai, kirim kode undanganmu ya — misalnya:\n' +
    '`daftar KODE123`\n\n' +
    'Belum punya kode? Hubungi tim digimaestro dulu.'
  );
}

export function invalidCodeReply(reason: string): string {
  return `${reason}\n\nCoba cek lagi kodenya, atau hubungi tim digimaestro ya 🙏`;
}

export function registeredReply(quotaMessages: number, trialDays: number): string {
  return (
    'Yeay, kamu berhasil terdaftar! 🎉\n\n' +
    `Masa coba: ${trialDays} hari · ${quotaMessages} pesan · 1 website.\n\n` +
    'Sekarang cerita dong — usahamu bergerak di bidang apa, dan namanya apa?'
  );
}
