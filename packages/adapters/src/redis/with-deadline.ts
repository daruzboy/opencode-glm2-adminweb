// P0 (insiden 2026-07-12): dua job chat-inbound macet SELAMANYA di state 'active' — worker
// idle 0% CPU, seluruh antrean beku (concurrency 2, dua slot terkunci).
//
// Akarnya: koneksi Redis BullMQ dibuat dengan `maxRetriesPerRequest: null` (wajib untuk
// koneksi blocking BullMQ). Efek sampingnya: saat Redis tak terjangkau, ioredis MENGANTRE
// perintah tanpa pernah reject → `await client.incr(...)` menggantung selamanya, dan
// `try/catch` fail-open di pemanggil TIDAK PERNAH menyala (catch hanya menangkap promise
// yang reject, bukan yang tak pernah selesai).
//
// Obatnya: setiap operasi Redis di jalur pesan diberi DEADLINE. Lewat deadline → reject →
// jatuh ke jalur fail-open yang memang sudah dirancang. Perintah yatim yang akhirnya jalan
// setelah timeout tidak berbahaya (increment counter / SET NX — idempoten secara efek).

export const DEFAULT_REDIS_DEADLINE_MS = 2_000;

export async function withDeadline<T>(op: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[REDIS_DEADLINE] ${label} tidak selesai dalam ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([op, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
