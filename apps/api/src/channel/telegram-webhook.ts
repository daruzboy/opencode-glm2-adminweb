// T-030tg: webhook Telegram (FR-CHN-001/005). Tepi sistem yang menghadap internet.
//
// Tiga gerbang, berurutan — kerja mahal (LLM) baru terjadi setelah semuanya lolos:
//   1. Keaslian: header secret token yang Telegram kirim balik di tiap update. Endpoint
//      ini publik (Telegram harus bisa memanggilnya), jadi ini satu-satunya bukti bahwa
//      pemanggilnya benar Telegram. Dibandingkan timing-safe.
//   2. Bentuk: Zod (AGENTS.md §3). Update yang bukan pesan → diabaikan, tetap 200.
//   3. Allowlist: chat_id tak dikenal → TIDAK di-enqueue, LLM tak tersentuh.
//
// Selalu balas 200 pada kasus yang sudah kita tangani. Telegram me-retry update yang
// dijawab non-2xx, jadi membalas error untuk pesan yang "sengaja diabaikan" akan memicu
// kiriman ulang tanpa akhir. Yang di-enqueue diproses worker (LLM butuh detik-detik,
// jauh melampaui toleransi webhook).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parseTelegramAllowlist,
  resolveTenantForChat,
  secureTokenEquals,
  telegramUpdateSchema,
  toInboundMessage,
} from '@digimaestro/adapters';
import type { ChatInboundQueuePort } from '@digimaestro/shared';

export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface TelegramWebhookDeps {
  readonly queue: ChatInboundQueuePort;
  // Self-serve (#6): resolusi tenant dari DB. Menggantikan allowlist env (yang tetap dipakai
  // sebagai bootstrap/admin).
  readonly resolveTenant?: (externalId: string) => Promise<string | null>;
  readonly allowRegistration?: boolean;
  // Secret yang didaftarkan via setWebhook(secret_token). Wajib — tanpa ini endpoint
  // publik bisa disuntik siapa saja.
  readonly secretToken: string;
  // "chat_id:tenantId,..." — lihat parseTelegramAllowlist.
  readonly allowlistRaw?: string;
}

export function registerTelegramWebhook(app: FastifyInstance, deps: TelegramWebhookDeps): void {
  const allowlist = parseTelegramAllowlist(deps.allowlistRaw);

  app.post('/api/webhooks/telegram', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1) Keaslian — perbandingan konstan-waktu (secureTokenEquals, adapters).
    if (!secureTokenEquals(req.headers[TELEGRAM_SECRET_HEADER], deps.secretToken)) {
      return reply.code(401).send({ error: 'secret token tidak valid' });
    }

    // 2) Bentuk. Payload cacat = bug kita atau bukan Telegram; 200 agar tak di-retry.
    const parsed = telegramUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(200).send({ ok: true, ignored: 'payload tidak dikenali' });
    }

    const message = toInboundMessage(parsed.data);
    if (!message) {
      return reply.code(200).send({ ok: true, ignored: 'update bukan pesan' });
    }

    // 3) Resolusi tenant: DB (self-serve) → allowlist env (bootstrap/admin).
    const fromDb = deps.resolveTenant ? await deps.resolveTenant(message.externalId) : null;
    const tenant = fromDb ?? resolveTenantForChat(allowlist, message.externalId);

    if (!tenant && !deps.allowRegistration) {
      req.log.warn({ chatId: message.externalId }, 'telegram: chat tak dikenal — diabaikan');
      return reply.code(200).send({ ok: true, ignored: 'chat tidak terdaftar' });
    }

    // Tak dikenal + pendaftaran aktif → enqueue TANPA tenantId (jalur kode undangan).
    // LLM tetap tak tersentuh → gerbang biaya (ADR-12) utuh.
    const enqueued = await deps.queue.enqueueInbound({
      ...(tenant ? { tenantId: tenant } : {}),
      message,
    });
    if (!enqueued.ok) {
      // Gagal enqueue = pesan HILANG kalau kita balas 200. Balas 500 supaya Telegram
      // mengirim ulang; dedup providerMsgId menahan efek ganda bila ternyata sempat masuk.
      req.log.error({ err: enqueued.error }, 'telegram: gagal enqueue pesan masuk');
      return reply.code(500).send({ error: enqueued.error.message });
    }

    return reply.code(200).send({ ok: true, jobId: enqueued.value.jobId });
  });
}
