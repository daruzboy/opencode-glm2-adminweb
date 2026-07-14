// P1: /readyz — kesiapan NYATA. Kontainer "hidup tapi buta DB/Redis" tidak boleh dianggap
// sehat (pelajaran insiden worker-stub & worker beku: hijau di luar, mati di dalam).

import { describe, expect, it, vi } from 'vitest';
import { buildServer } from './index.js';

describe('GET /readyz', () => {
  it('semua probe ok → 200 ready', async () => {
    const app = await buildServer({
      ready: { db: async () => undefined, redis: async () => undefined },
    });
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', db: 'ok', redis: 'ok' });
  });

  it('DB gagal → 503 + probe mana yang gagal terlihat', async () => {
    const app = await buildServer({
      ready: {
        db: async () => {
          throw new Error('connection refused');
        },
        redis: async () => undefined,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { status: string; db: string; redis: string };
    expect(body.status).toBe('unready');
    expect(body.db).toContain('connection refused');
    expect(body.redis).toBe('ok');
  });

  // Probe yang MENGGANTUNG (Redis mengantre perintah tanpa reject — pola insiden P0) harus
  // jadi "unready" pada deadline, bukan healthcheck yang ikut menggantung.
  it('probe menggantung → 503 pada deadline (bukan ikut menggantung)', async () => {
    vi.useFakeTimers();
    try {
      const app = await buildServer({
        ready: {
          db: async () => undefined,
          redis: () => new Promise<void>(() => undefined), // tak pernah selesai
          deadlineMs: 2_000,
        },
      });
      const pending = app.inject({ method: 'GET', url: '/readyz' });
      await vi.advanceTimersByTimeAsync(2_001);
      const res = await pending;

      expect(res.statusCode).toBe(503);
      expect((res.json() as { redis: string }).redis).toContain('REDIS_DEADLINE');
    } finally {
      vi.useRealTimers();
    }
  });

  // Dependensi yang tak dikonfigurasi (mis. dev tanpa Redis) ≠ tak siap.
  it('probe tak dikonfigurasi → skipped, tetap 200', async () => {
    const app = await buildServer({ ready: { db: async () => undefined } });
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', db: 'ok', redis: 'skipped' });
  });

  // /healthz tetap liveness murni — kontrak lama tak berubah.
  it('/healthz tetap ada (liveness), tanpa probe', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
  });
});
