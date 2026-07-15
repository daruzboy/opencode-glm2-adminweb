// T-032tg: kabari pengguna di chat saat situsnya selesai (atau gagal) terbit.
// Menutup lingkaran approval: tap "Setuju & publish" (T-031tg) → job → ... → "sudah live".
// Tanpa ini pengguna ditinggal senyap setelah menyetujui — dan alur demo (T-083) tak
// pernah benar-benar tuntas tanpa orang mengintip log.
//
// Murni Port: tak kenal Telegram, BullMQ, maupun Prisma. Dipanggil worker publish setelah
// job selesai (sukses) atau habis retry (dead-letter).

import { err, ok } from '@digimaestro/shared';
import type {
  ChannelPort,
  ConversationRepository,
  MessageRepository,
  MessageStatus,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { approvalButtons } from './handle-inbound.js';

export interface NotifyDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly channel: ChannelPort;
}

export type PublishOutcomeNotice =
  | { readonly kind: 'live'; readonly url: string }
  // Pratinjau PUBLIK siap (mode 'preview'): pesan + TOMBOL approval — inilah momen
  // pelanggan pertama kali melihat situsnya (gerbang akhir BRU-02).
  | { readonly kind: 'preview'; readonly url: string; readonly revisionNumber: number }
  | { readonly kind: 'failed'; readonly reason: string };

export interface NotifyRequest {
  readonly tenantId: TenantId;
  readonly notice: PublishOutcomeNotice;
}

export interface NotifyResult {
  // false = tenant ini tak punya percakapan di kanal tsb (mis. pengguna web-only) →
  // bukan kegagalan, tak ada yang perlu dikabari.
  readonly notified: boolean;
  readonly conversationId?: string;
  readonly sent?: boolean;
}

export function livePublishMessage(url: string): string {
  return `Situsmu sudah LIVE 🎉\n\nBuka di sini:\n${url}\n\nMau ubah sesuatu? Tulis aja, nanti aku revisi.`;
}

export function previewReadyMessage(url: string): string {
  return (
    `Situsmu sudah siap! 🎉\n\nIntip dulu di sini:\n${url}\n\n` +
    'Kalau sudah pas, tekan "Setuju & publish" ya — atau bilang apa yang mau diubah.'
  );
}

export function failedPublishMessage(reason: string): string {
  return (
    `Yah, publikasinya gagal 😔\n\nAlasannya: ${reason}\n\n` +
    'Draft kamu aman kok — nggak ada yang hilang. Bilang aja kalau mau aku coba lagi.'
  );
}

// Kirim TEKS bebas ke chat tenant (dipakai billing E1: link bayar + konfirmasi lunas).
// Mekanika sama dgn notifikasi publish: cari percakapan ber-externalId, kirim, catat OUT.
export async function notifyTenantText(
  deps: NotifyDeps,
  tenantId: TenantId,
  text: string,
): Promise<Result<NotifyResult, RepositoryError>> {
  const convs = await deps.conversations.findMany(tenantId, { channel: deps.channel.channel });
  if (!convs.ok) return err(convs.error);
  const target = convs.value.find((c) => c.externalId !== null);
  if (!target?.externalId) return ok({ notified: false });

  const sent = await deps.channel.sendText(target.externalId, text);
  const outgoing = await deps.messages.create(tenantId, {
    conversationId: target.id,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMsgId: sent.ok
      ? sent.value.providerMsgId
      : `${deps.channel.channel.toLowerCase()}-notify-failed-${target.id}-${Date.now()}`,
    status: sent.ok ? 'SENT' : 'FAILED',
  });
  if (!outgoing.ok) return err(outgoing.error);
  return ok({ notified: true, conversationId: target.id, sent: sent.ok });
}

export async function notifyPublishOutcome(
  deps: NotifyDeps,
  req: NotifyRequest,
): Promise<Result<NotifyResult, RepositoryError>> {
  // Cari percakapan tenant di kanal yang kita pakai untuk mengabari (mis. TELEGRAM).
  const convs = await deps.conversations.findMany(req.tenantId, {
    channel: deps.channel.channel,
  });
  if (!convs.ok) return err(convs.error);

  // Butuh externalId (chat_id) sebagai tujuan kirim. Percakapan tanpa externalId (WEB)
  // tak bisa di-push — pengguna web melihat statusnya di portal, bukan lewat push.
  const target = convs.value.find((c) => c.externalId !== null);
  if (!target?.externalId) return ok({ notified: false });

  const text =
    req.notice.kind === 'live'
      ? livePublishMessage(req.notice.url)
      : req.notice.kind === 'preview'
        ? previewReadyMessage(req.notice.url)
        : failedPublishMessage(req.notice.reason);

  // Pratinjau membawa tombol persetujuan (gerbang akhir pelanggan, BRU-02).
  const sent =
    req.notice.kind === 'preview'
      ? await deps.channel.sendButtons(
          target.externalId,
          text,
          approvalButtons(req.notice.revisionNumber, String(req.tenantId)),
        )
      : await deps.channel.sendText(target.externalId, text);
  const status: MessageStatus = sent.ok ? 'SENT' : 'FAILED';

  // Notifikasi tetap dicatat sebagai pesan OUT → riwayat chat utuh (pengguna melihat
  // kabar ini di transkrip, bukan cuma sebagai push yang menguap).
  const outgoing = await deps.messages.create(req.tenantId, {
    conversationId: target.id,
    direction: 'OUT',
    type: 'TEXT',
    text,
    providerMsgId: sent.ok
      ? sent.value.providerMsgId
      : `${deps.channel.channel.toLowerCase()}-notify-failed-${target.id}-${Date.now()}`,
    status,
  });
  if (!outgoing.ok) return err(outgoing.error);

  return ok({ notified: true, conversationId: target.id, sent: sent.ok });
}
