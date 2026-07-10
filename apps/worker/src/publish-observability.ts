// Observability siklus-hidup job publish (T-063 hardening). Formatter log MURNI (tanpa
// BullMQ/IO) → teruji offline; publish-worker menempelkannya ke event Worker. Log terstruktur
// satu-baris (prefix + key=val) agar mudah di-grep di stdout kontainer (docker compose).

// Bidang job minimal yang kita log (subset BullMQ Job, struktural → tak bergantung vendor).
export interface JobLogView {
  readonly id?: string | null;
  readonly attemptsMade: number;
  readonly data: { readonly kind?: string; readonly websiteId?: string; readonly slug?: string };
  readonly opts?: { readonly attempts?: number };
}

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const PREFIX = '[publish-worker]';

function idOf(job: JobLogView): string {
  return job.id ?? 'unknown';
}

function tagsOf(job: JobLogView): string {
  const kind = job.data.kind ?? 'publish';
  const website = job.data.websiteId ?? '-';
  const slug = job.data.slug ?? '-';
  return `job=${idOf(job)} kind=${kind} website=${website} slug=${slug}`;
}

// Percobaan terakhir sudah habis? attemptsMade dihitung SETELAH percobaan gagal ini,
// jadi job final gagal (dead-letter) bila attemptsMade >= attempts terkonfigurasi.
export function isDeadLetter(job: JobLogView): boolean {
  const max = job.opts?.attempts ?? 1;
  return job.attemptsMade >= max;
}

export function formatJobStart(job: JobLogView): string {
  return `${PREFIX} mulai ${tagsOf(job)} attempt=${job.attemptsMade + 1}`;
}

export function formatJobSuccess(job: JobLogView, durationMs: number): string {
  return `${PREFIX} sukses ${tagsOf(job)} durasi_ms=${durationMs}`;
}

// Kegagalan satu percobaan. Bila dead-letter → tandai eksplisit agar bisa di-alert/di-grep.
export function formatJobFailure(job: JobLogView, reason: string): string {
  const max = job.opts?.attempts ?? 1;
  const dead = isDeadLetter(job);
  const tag = dead ? 'DEAD-LETTER' : 'gagal';
  return `${PREFIX} ${tag} ${tagsOf(job)} attempt=${job.attemptsMade}/${max} alasan=${reason}`;
}
