// apps/worker — konsumen BullMQ untuk AgentJob, build Astro, deploy, verifikasi DNS (SRS §3.2, ADR-2).
// BullMQ + Redis dipasang saat EPIC-05/06. Untuk T-010 ini skeleton.

export const WORKER_NAME = 'digimaestro-worker';

export interface WorkerHandle {
  readonly name: string;
  readonly running: boolean;
}

export function startWorker(name: string = WORKER_NAME): WorkerHandle {
  return { name, running: true };
}
