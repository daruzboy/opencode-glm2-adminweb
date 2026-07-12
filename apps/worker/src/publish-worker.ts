// BullMQ Worker untuk antrean publish (T-063, ADR-2; SRS §3.2). Wrapper TIPIS di atas
// dispatcher murni processPublishJob: satu-satunya bagian yang menyentuh BullMQ/Redis.
// Job gagal → throw agar BullMQ menandai failed & retry sesuai opts job (attempts/backoff
// diset produsen via defaultPublishJobOptions). Observability: log siklus-hidup + dead-letter.

import { Worker, type ConnectionOptions } from 'bullmq';
import { PUBLISH_QUEUE, processPublishJob, type PublishQueueJob } from './publish-job.js';
import {
  formatJobFailure,
  formatJobStart,
  formatJobSuccess,
  isDeadLetter,
  type JobLogView,
  type Logger,
} from './publish-observability.js';
import type { AlertPort } from '@digimaestro/shared';
import type { PublishDeps } from './publish.js';

// T-032tg: pengabar hasil publish ke chat pengguna. Opsional — worker publish tetap jalan
// tanpa kanal (mis. lingkungan tanpa kredensial bot).
export interface PublishNotifier {
  publishSucceeded(tenantId: string, url: string): Promise<void>;
  publishFailed(tenantId: string, reason: string): Promise<void>;
}

// Siapa yang harus dikabari untuk job ini? null = tak seorang pun:
//  - rollback bukan aksi yang diminta pengguna lewat chat → tak perlu dikabari;
//  - job lama (antre sebelum T-032tg) tak punya tenantId → dilewati, bukan crash.
// Fungsi murni → aturan ini teruji tanpa Redis/BullMQ.
export function notifyTarget(data: PublishQueueJob): string | null {
  if (data.kind !== 'publish') return null;
  return data.tenantId ?? null;
}

// Kabari kegagalan HANYA saat percobaan terakhir habis. Mengabari tiap percobaan akan
// membuat pengguna panik untuk kegagalan transien yang sedetik kemudian pulih sendiri.
export function shouldNotifyFailure(view: JobLogView, data: PublishQueueJob): boolean {
  return isDeadLetter(view) && notifyTarget(data) !== null;
}

export interface PublishWorkerOptions {
  readonly connection: ConnectionOptions;
  readonly concurrency?: number;
  // Logger terinjeksi (default console) → memudahkan uji & routing log terstruktur.
  readonly logger?: Logger;
  readonly notifier?: PublishNotifier;
  // T-070: job yang habis retry (dead-letter) BERARTI situs pelanggan gagal terbit.
  // Sebelumnya hanya masuk log → tak seorang pun tahu. Kini PO diberi tahu.
  readonly alert?: AlertPort;
}

export function startPublishWorker(deps: PublishDeps, options: PublishWorkerOptions): Worker<PublishQueueJob> {
  const logger = options.logger ?? console;

  const worker = new Worker<PublishQueueJob>(
    PUBLISH_QUEUE,
    async (job) => {
      logger.info(formatJobStart(job as unknown as JobLogView));
      const startedAt = Date.now();
      const result = await processPublishJob(deps, job.data);
      if (!result.ok) {
        // Throw = BullMQ tandai job gagal → retry (attempts/backoff dari produsen job).
        // Notifikasi gagal TIDAK dikirim di sini: percobaan ini mungkin masih akan
        // di-retry dan berhasil. Pengguna baru dikabari saat dead-letter (lihat 'failed').
        throw new Error(`[${result.error.code}] ${result.error.message}`);
      }
      logger.info(formatJobSuccess(job as unknown as JobLogView, Date.now() - startedAt));

      // Publikasi sudah sukses — kegagalan mengabari TIDAK boleh membatalkannya (throw =
      // BullMQ retry → situs ter-deploy ulang percuma). Cukup dicatat.
      const target = notifyTarget(job.data);
      if (target && options.notifier) {
        try {
          await options.notifier.publishSucceeded(target, result.value.url);
        } catch (e) {
          logger.error(`[publish-worker] gagal mengabari "sudah live": ${asMessage(e)}`);
        }
      }
      return result.value;
    },
    { connection: options.connection, concurrency: options.concurrency ?? 1 },
  );

  // Event failed dipancarkan tiap percobaan gagal; formatter menandai DEAD-LETTER saat
  // percobaan terakhir habis (attemptsMade >= attempts) → mudah di-grep/alert di stdout.
  worker.on('failed', (job, err) => {
    if (!job) {
      logger.error(`[publish-worker] gagal tanpa konteks job: ${err.message}`);
      return;
    }
    const view = job as unknown as JobLogView;
    logger.error(formatJobFailure(view, err.message));

    const data = job.data as PublishQueueJob;

    // Dead-letter = kegagalan FINAL. Kabari PO (bukan hanya pengguna).
    if (isDeadLetter(view) && options.alert) {
      void options.alert
        .notify({
          key: `publish-dead-letter:${data.websiteId}`,
          severity: 'error',
          title: 'Publish situs GAGAL (retry habis)',
          detail: err.message,
          context: {
            websiteId: data.websiteId,
            slug: data.slug,
            percobaan: `${view.attemptsMade}/${view.opts?.attempts ?? 1}`,
          },
        })
        .catch(() => undefined);
    }

    if (!options.notifier || !shouldNotifyFailure(view, data)) return;

    void options.notifier
      .publishFailed(notifyTarget(data) as string, err.message)
      .catch((e: unknown) =>
        logger.error(`[publish-worker] gagal mengabari kegagalan publish: ${asMessage(e)}`),
      );
  });

  return worker;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
