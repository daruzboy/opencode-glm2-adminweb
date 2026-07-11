import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import {
  RedisInboundRateLimiter,
  type RedisRateCommands,
} from '../redis-inbound-rate-limiter.js';

const T = tenantId('t1');

// Fake Redis in-memory (counter + TTL kasar) — cukup untuk menguji aturannya.
function fakeRedis(): RedisRateCommands & { counts: Map<string, number>; sets: Set<string> } {
  const counts = new Map<string, number>();
  const sets = new Set<string>();
  return {
    counts,
    sets,
    async incr(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    async pexpire() {
      return 1;
    },
    async set(key, _v, _m, _ttl, _nx) {
      if (sets.has(key)) return null; // sudah ada → NX gagal
      sets.add(key);
      return 'OK';
    },
  };
}

function limiter(redis: RedisRateCommands, limit = 3) {
  return new RedisInboundRateLimiter(async () => redis, { limit, windowMs: 60_000 });
}

describe('RedisInboundRateLimiter — gerbang biaya pesan masuk', () => {
  it('di bawah batas → allowed', async () => {
    const l = limiter(fakeRedis(), 3);

    expect((await l.check(T)).allowed).toBe(true);
    expect((await l.check(T)).allowed).toBe(true);
    expect((await l.check(T)).allowed).toBe(true);
  });

  it('melewati batas → DITOLAK (LLM tak akan dipanggil)', async () => {
    const l = limiter(fakeRedis(), 3);
    for (let i = 0; i < 3; i += 1) await l.check(T);

    const over = await l.check(T);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSec).toBe(60);
  });

  // Membalas peringatan tiap pesan spam = kita ikut membanjiri pengguna.
  it('peringatan dikirim HANYA sekali per jendela', async () => {
    const l = limiter(fakeRedis(), 1);
    await l.check(T);

    const first = await l.check(T);
    const second = await l.check(T);
    const third = await l.check(T);

    expect(first.shouldWarn).toBe(true);
    expect(second.shouldWarn).toBe(false);
    expect(third.shouldWarn).toBe(false);
  });

  it('kuota terpisah per tenant', async () => {
    const l = limiter(fakeRedis(), 1);
    await l.check(T);

    expect((await l.check(tenantId('t2'))).allowed).toBe(true);
  });

  // TTL hanya di hit pertama → pengirim banjir tak bisa menahan kunci selamanya.
  it('TTL diset hanya pada hit PERTAMA (fixed window)', async () => {
    const redis = fakeRedis();
    const pexpire = vi.spyOn(redis, 'pexpire');
    const l = limiter(redis, 5);

    await l.check(T);
    await l.check(T);
    await l.check(T);

    expect(pexpire).toHaveBeenCalledTimes(1);
  });

  // FAIL-OPEN disengaja: Redis tersendat tak boleh mematikan bot. Aman karena bila Redis
  // benar-benar mati, antrean chat-inbound juga mati → tak ada pesan sampai ke LLM.
  it('Redis error → fail-open + dicatat (bot tak mati)', async () => {
    const errors: string[] = [];
    const l = new RedisInboundRateLimiter(
      async () => {
        throw new Error('redis down');
      },
      { limit: 1, windowMs: 60_000, logger: { error: (m) => errors.push(m) } },
    );

    const d = await l.check(T);

    expect(d.allowed).toBe(true);
    expect(errors.some((e) => e.includes('redis down'))).toBe(true);
  });
});
