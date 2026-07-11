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
import type { Logger } from './publish-observability.js';

export interface ChatInboundWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly concurrency?: number;
  readonly logger?: Logger;
}

export function startChatInboundWorker(
  deps: InboundDeps,
  options: ChatInboundWorkerOptions,
): Worker<ChatInboundJob> {
  const logger = options.logger ?? console;

  const worker = new Worker<ChatInboundJob>(
    CHAT_INBOUND_QUEUE_NAME,
    async (job) => {
      const { tenantId: tid, message } = job.data;
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
    },
    { connection: options.connection, concurrency: options.concurrency ?? 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[chat-inbound] job ${job?.id ?? '?'} gagal: ${err.message}`);
  });

  return worker;
}
