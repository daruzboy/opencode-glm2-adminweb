// apps/worker — konsumen BullMQ untuk publish pipeline + AgentJob (SRS §3.2, ADR-2).
// T-063: antrean `publish` (build→store→deploy→verify) di-consume via BullMQ Worker.
// Bootstrap proses long-running menjaga kontainer worker (docker compose) hidup & shutdown
// rapi (SIGTERM/SIGINT). Konsumen AgentJob (agent build/edit) menyusul EPIC-05/06.

import { pathToFileURL } from 'node:url';
import type { Worker } from 'bullmq';
import { createPublishDeps, createRedisConnection } from './composition.js';
import { createInboundDeps } from './chat-composition.js';
import { startChatInboundWorker } from './chat-inbound-worker.js';
import { startPublishWorker } from './publish-worker.js';

// Kontrak antrean publish untuk produsen job (mis. apps/api saat approve→publish).
export { PUBLISH_QUEUE } from './publish-job.js';
export type { PublishQueueJob, PublishJobData, RollbackJobData } from './publish-job.js';
export { startPublishWorker } from './publish-worker.js';
export { createPublishDeps, createRedisConnection } from './composition.js';
export { startChatInboundWorker } from './chat-inbound-worker.js';
export { createInboundDeps, createTelegramChannel, createChatReplier } from './chat-composition.js';

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
  const workers: Worker[] = [startPublishWorker(createPublishDeps(), { connection })];
  console.log(`[${handle.name}] started — konsumen antrean 'publish' aktif (BullMQ).`);

  if (process.env.TELEGRAM_BOT_TOKEN) {
    workers.push(startChatInboundWorker(createInboundDeps(), { connection }));
    console.log(`[${handle.name}] konsumen antrean 'chat-inbound' aktif (Telegram).`);
  } else {
    console.log(`[${handle.name}] TELEGRAM_BOT_TOKEN kosong — konsumen 'chat-inbound' dilewati.`);
  }

  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      console.log(`[${handle.name}] ${signal} diterima — menutup worker...`);
      void Promise.all(workers.map((w) => w.close())).then(() => resolve());
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void runWorker();
