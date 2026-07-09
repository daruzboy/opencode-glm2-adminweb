// apps/worker — konsumen BullMQ untuk AgentJob, build Astro, deploy, verifikasi DNS (SRS §3.2, ADR-2).
// BullMQ + Redis dipasang saat EPIC-05/06. Untuk T-010 ini skeleton; T-012 menambahkan
// bootstrap proses long-running agar kontainer worker (docker compose) tetap hidup &
// shutdown rapi (SIGTERM/SIGINT) tanpa mengubah kontrak `startWorker`.

import { pathToFileURL } from 'node:url';

export const WORKER_NAME = 'digimaestro-worker';

export interface WorkerHandle {
  readonly name: string;
  readonly running: boolean;
}

export function startWorker(name: string = WORKER_NAME): WorkerHandle {
  return { name, running: true };
}

// Proses long-running untuk kontainer: mulai worker, lalu tunggu sinyal shutdown.
// Konsumen antrean BullMQ nyata menyusul (EPIC-05/06) — di sini cukup jaga proses hidup
// sehingga service `worker` di compose tidak restart-loop.
export async function runWorker(): Promise<void> {
  const handle = startWorker();
  // eslint-disable-next-line no-console
  console.log(`[${handle.name}] started (skeleton — konsumen BullMQ dipasang di EPIC-05/06)`);

  await new Promise<void>((resolve) => {
    // Timer ref'd menjaga event loop tetap hidup sampai sinyal shutdown (tanpa antrean
    // nyata, signal handler saja tidak menahan proses). Diganti loop BullMQ di EPIC-05/06.
    const keepAlive = setInterval(() => undefined, 60_000);
    const shutdown = (signal: NodeJS.Signals): void => {
      clearInterval(keepAlive);
      // eslint-disable-next-line no-console
      console.log(`[${handle.name}] ${signal} diterima — shutdown.`);
      resolve();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void runWorker();
