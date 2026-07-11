// apps/worker — konsumen BullMQ untuk publish pipeline + AgentJob (SRS §3.2, ADR-2).
// T-063: antrean `publish` (build→store→deploy→verify) di-consume via BullMQ Worker.
// Bootstrap proses long-running menjaga kontainer worker (docker compose) hidup & shutdown
// rapi (SIGTERM/SIGINT). Konsumen AgentJob (agent build/edit) menyusul EPIC-05/06.

import { pathToFileURL } from 'node:url';
import type { Worker } from 'bullmq';
import { createPublishDeps, createRedisConnection } from './composition.js';
import {
  createAlert,
  createInboundDeps,
  createPublishNotifier,
  startPoller,
} from './chat-composition.js';
import { startChatInboundWorker } from './chat-inbound-worker.js';
import { startPublishWorker } from './publish-worker.js';

// Kontrak antrean publish untuk produsen job (mis. apps/api saat approve→publish).
export { PUBLISH_QUEUE } from './publish-job.js';
export type { PublishQueueJob, PublishJobData, RollbackJobData } from './publish-job.js';
export { startPublishWorker } from './publish-worker.js';
export { createPublishDeps, createRedisConnection } from './composition.js';
export { startChatInboundWorker } from './chat-inbound-worker.js';
export {
  createAlert,
  createInboundDeps,
  createPublishNotifier,
  createTelegramChannel,
  createChatReplier,
  startPoller,
} from './chat-composition.js';

export const WORKER_NAME = 'digimaestro-worker';

export interface WorkerHandle {
  readonly name: string;
  readonly running: boolean;
}

export function startWorker(name: string = WORKER_NAME): WorkerHandle {
  return { name, running: true };
}

// Proses long-running untuk kontainer: mulai konsumen BullMQ publish, lalu tunggu sinyal
// shutdown & tutup worker dgn rapi (drain koneksi Redis). Konsumen AgentJob menyusul EPIC-05/06.
//
// T-030tg: konsumen `chat-inbound` (pesan Telegram → agent → balasan) menyala hanya bila
// TELEGRAM_BOT_TOKEN diisi — worker publish tetap hidup di lingkungan tanpa kredensial bot.
export async function runWorker(): Promise<void> {
  const handle = startWorker();
  const connection = createRedisConnection();
  // T-032tg: notifier mengabari pengguna di chat saat situsnya live / gagal terbit.
  // undefined tanpa TELEGRAM_BOT_TOKEN → publish tetap jalan, hanya tanpa kabar.
  const notifier = createPublishNotifier();
  // T-070: alert operasional ke PO (job dead-letter, bot mati, pesan gagal diproses).
  const alert = createAlert();
  const workers: Worker[] = [
    startPublishWorker(createPublishDeps(), {
      connection,
      ...(notifier ? { notifier } : {}),
      ...(alert ? { alert } : {}),
    }),
  ];
  if (alert) console.log(`[${handle.name}] alert operasional AKTIF.`);
  else console.log(`[${handle.name}] alert operasional tidak aktif (ALERT_TELEGRAM_CHAT_ID kosong).`);
  console.log(`[${handle.name}] started — konsumen antrean 'publish' aktif (BullMQ).`);

  let poller: ReturnType<typeof startPoller>;
  if (process.env.TELEGRAM_BOT_TOKEN) {
    workers.push(
      startChatInboundWorker(createInboundDeps(), {
        connection,
        ...(alert ? { alert } : {}),
      }),
    );
    console.log(`[${handle.name}] konsumen antrean 'chat-inbound' aktif (Telegram).`);

    // TELEGRAM_MODE=polling → kita yang menarik update dari Telegram (VPS tanpa domain
    // publik). Tanpa itu, update masuk lewat webhook di apps/api.
    poller = startPoller(process.env, alert);
    if (poller) console.log(`[${handle.name}] long-polling Telegram aktif (tanpa webhook).`);
  } else {
    console.log(`[${handle.name}] TELEGRAM_BOT_TOKEN kosong — konsumen 'chat-inbound' dilewati.`);
  }

  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      console.log(`[${handle.name}] ${signal} diterima — menutup worker...`);
      poller?.stop();
      void Promise.all(workers.map((w) => w.close())).then(() => resolve());
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void runWorker();
