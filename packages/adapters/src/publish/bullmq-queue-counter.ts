// Dashboard admin (PO 2026-07-15): hitung isi antrean BullMQ (menunggu/aktif/gagal).
// Satu-satunya tempat bullmq disentuh utk keperluan BACA metrik.

import { Queue, type ConnectionOptions } from 'bullmq';

export interface QueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
}

export function createQueueCounter(
  connection: ConnectionOptions,
): (name: string) => Promise<QueueCounts> {
  const queues = new Map<string, Queue>();
  return async (name: string) => {
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection });
      queues.set(name, q);
    }
    const c = await q.getJobCounts('waiting', 'active', 'failed');
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, failed: c.failed ?? 0 };
  };
}
