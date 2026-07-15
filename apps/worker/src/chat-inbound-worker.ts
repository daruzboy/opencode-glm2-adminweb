// T-030tg: konsumen BullMQ antrean `chat-inbound`. Wrapper TIPIS di atas use case murni
// handleInboundMessage (core) — satu-satunya bagian yang menyentuh BullMQ/Redis.
//
// Di sinilah LLM dipanggil, bukan di webhook: agent bisa makan beberapa detik, sementara
// Telegram menganggap webhook yang lambat = gagal lalu mengirim ulang update yang sama.
//
// Job gagal → throw agar BullMQ retry (attempts/backoff diset produsen). Retry aman:
// providerMsgId @unique membuat pemrosesan ulang terdeteksi sebagai duplikat, jadi
// pengguna tak menerima balasan dobel.

import { Worker, type ConnectionOptions } from 'bullmq';
import { handleInboundMessage, type InboundDeps } from '@digimaestro/core';
import { CHAT_INBOUND_QUEUE_NAME, tenantId, type ChatInboundJob } from '@digimaestro/shared';
import type { InboundChannelMessage } from '@digimaestro/shared';
import type { AlertPort } from '@digimaestro/shared';
import type { Logger } from './publish-observability.js';

export interface ChatInboundWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly concurrency?: number;
  readonly logger?: Logger;
  // T-070: pesan pelanggan yang gagal diproses = pelanggan diabaikan.
  readonly alert?: AlertPort;
  // Self-serve (#6): chat yang BELUM dikenal → jalur pendaftaran (kode undangan).
  // TANPA memanggil LLM — jalur ini terbuka bagi siapa pun yang menemukan bot.
  readonly registration?: RegistrationHandler;
  // Konsol admin via chat (PO 2026-07-15).
  readonly adminConsole?: AdminConsoleHandler;
  // P0 (insiden 2026-07-12): batas waktu SATU job. Tanpa ini, satu `await` yang tak pernah
  // selesai (Redis mengantre perintah tanpa reject) membuat job macet di 'active' selamanya —
  // dua job macet = worker (concurrency 2) beku total, dan TIDAK ADA alert karena job tak
  // pernah "gagal". Timeout mengubah hang senyap jadi kegagalan yang terlihat: BullMQ retry,
  // lalu alert T-070 saat retry habis.
  readonly jobTimeoutMs?: number;
}

// Cukup untuk build terlama yang sah (BUILD_LLM_TIMEOUT_MS=180s per percobaan LLM dibatasi
// terpisah); yang dikejar di sini adalah hang tak wajar, bukan kerja lambat.
export const DEFAULT_CHAT_JOB_TIMEOUT_MS = 300_000;

// Menangani chat tak dikenal. Dipisah dari InboundDeps karena ia bekerja SEBELUM tenant ada.
export interface RegistrationHandler {
  handle(message: InboundChannelMessage): Promise<void>;
}

// Konsol admin (/konsumen …): perintah deterministik dari chat ADMIN — dieksekusi
// SEBELUM handleInboundMessage & TANPA LLM. null = bukan perintah konsol.
export interface AdminConsoleHandler {
  handle(chatId: string, text: string): Promise<{ readonly reply: string } | null>;
  sendReply(chatId: string, text: string): Promise<void>;
}

// Batas waktu keras untuk satu promise job. Setelah lewat, job dianggap GAGAL walau
// promise aslinya masih menggantung di belakang (promise yatim itu tak bisa dibatalkan —
// tak apa: retry aman karena providerMsgId @unique menahan balasan dobel).
export async function raceJobTimeout<T>(work: Promise<T>, ms: number, jobId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[JOB_TIMEOUT] job ${jobId} melewati ${ms}ms — dihentikan paksa`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function startChatInboundWorker(
  deps: InboundDeps,
  options: ChatInboundWorkerOptions,
): Worker<ChatInboundJob> {
  const logger = options.logger ?? console;
  const jobTimeoutMs = options.jobTimeoutMs ?? DEFAULT_CHAT_JOB_TIMEOUT_MS;

  const processJob = async (job: { data: ChatInboundJob }): Promise<unknown> => {
    const { tenantId: tid, message } = job.data;

    // Chat belum terikat ke tenant → PENDAFTARAN, bukan percakapan. LLM tidak disentuh.
    if (!tid) {
      if (!options.registration) {
        logger.error('[chat-inbound] chat tak dikenal & pendaftaran tak aktif — diabaikan');
        return { conversationId: '', duplicate: false };
      }
      await options.registration.handle(message);
      return { conversationId: '', duplicate: false };
    }

    // Konsol admin: /konsumen … dari chat admin → jawab deterministik, LLM tak disentuh.
    if (options.adminConsole && message.type === 'TEXT' && message.text) {
      const admin = await options.adminConsole.handle(message.externalId, message.text);
      if (admin) {
        await options.adminConsole.sendReply(message.externalId, admin.reply);
        return { conversationId: '', duplicate: false };
      }
    }

    const result = await handleInboundMessage(deps, {
      tenantId: tenantId(tid),
      message,
    });

    if (!result.ok) {
      // Throw → BullMQ tandai gagal & retry.
      throw new Error(`[${result.error.code}] ${result.error.message}`);
    }

    if (result.value.duplicate) {
      logger.info(
        `[chat-inbound] duplikat diabaikan providerMsgId=${message.providerMsgId} (idempoten)`,
      );
      return result.value;
    }

    // Balasan gagal terkirim bukan alasan me-retry seluruh job: pesan IN sudah tercatat,
    // dan retry hanya akan mendarat di jalur duplikat tanpa pernah mengirim ulang.
    // Cukup dicatat keras agar terlihat di alert (T-070).
    if (result.value.sent === false) {
      logger.error(
        `[chat-inbound] balasan GAGAL dikirim ke kanal ${message.channel} chat=${message.externalId}`,
      );
    }
    return result.value;
  };

  const worker = new Worker<ChatInboundJob>(
    CHAT_INBOUND_QUEUE_NAME,
    (job) => raceJobTimeout(processJob(job), jobTimeoutMs, String(job.id ?? '?')),
    // lockDuration/stalled dibiarkan default (30 s): lock diperpanjang otomatis selama proses
    // hidup, jadi pemulihan job saat proses MATI tetap cepat; hang di dalam proses ditangani
    // raceJobTimeout di atas.
    { connection: options.connection, concurrency: options.concurrency ?? 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[chat-inbound] job ${job?.id ?? '?'} gagal: ${err.message}`);

    // Hanya saat retry HABIS — kegagalan transien tak perlu membangunkan PO.
    const habis = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1);
    if (habis && options.alert) {
      void options.alert
        .notify({
          key: 'chat-inbound-failed',
          severity: 'error',
          title: 'Pesan pelanggan GAGAL diproses',
          detail: err.message,
          context: { jobId: String(job?.id ?? '?'), tenant: String(job?.data?.tenantId ?? '?') },
        })
        .catch(() => undefined);
    }
  });

  return worker;
}
