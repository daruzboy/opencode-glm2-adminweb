import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Alert, type AlertPort } from '@digimaestro/shared';
import { TelegramAlert, formatAlert } from '../telegram-alert.js';
import { ThrottledAlert } from '../throttled-alert.js';
import { MultiAlert, WebhookAlert } from '../webhook-alert.js';
import type { RedisRateCommands } from '../../telegram/redis-inbound-rate-limiter.js';

const ALERT: Alert = {
  key: 'publish-dead-letter:w1',
  severity: 'error',
  title: 'Publish situs GAGAL (retry habis)',
  detail: '[DEPLOY] koneksi cPanel putus',
  context: { slug: 'warung-sate', percobaan: '3/3' },
};

describe('TelegramAlert', () => {
  it('kirim ke chat OPS (bukan chat pelanggan)', async () => {
    const sendText = vi.fn(async () => ok({ providerMsgId: 'x' }));
    const alert = new TelegramAlert({
      opsChatId: '999-ops',
      channel: { channel: 'TELEGRAM', sendText, sendButtons: vi.fn(), answerCallback: vi.fn() } as never,
    });

    const res = await alert.notify(ALERT);

    expect(res.ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith('999-ops', expect.stringContaining('Publish situs GAGAL'));
  });

  // Alert harus BISA DITINDAK: apa, di mana, konteks secukupnya — bukan sekadar "error".
  it('pesan memuat detail + konteks', () => {
    const text = formatAlert(ALERT, 'production');

    expect(text).toContain('🔴');
    expect(text).toContain('env: production');
    expect(text).toContain('koneksi cPanel putus');
    expect(text).toContain('slug: warung-sate');
  });
});

describe('ThrottledAlert — satu masalah ≠ ratusan notifikasi', () => {
  function fakeRedis(): RedisRateCommands {
    const seen = new Set<string>();
    return {
      incr: vi.fn(),
      pexpire: vi.fn(),
      async set(key) {
        if (seen.has(key)) return null; // NX gagal → sudah pernah dialertkan
        seen.add(key);
        return 'OK';
      },
    } as unknown as RedisRateCommands;
  }

  function inner() {
    return { notify: vi.fn(async () => ok(undefined)) };
  }

  // Kalau LLM tumbang, 100 pesan gagal TIDAK boleh jadi 100 notifikasi — PO akan mematikan
  // alertnya, dan alert yang dimatikan = tidak ada alert.
  it('alert key sama berulang → hanya kirim SEKALI per jendela', async () => {
    const target = inner();
    const redis = fakeRedis();
    const t = new ThrottledAlert(target, async () => redis, { cooldownMs: 60_000 });

    for (let i = 0; i < 10; i += 1) await t.notify(ALERT);

    expect(target.notify).toHaveBeenCalledTimes(1);
  });

  it('key BERBEDA → tetap dikirim (masalah berbeda ≠ diredam)', async () => {
    const target = inner();
    const redis = fakeRedis();
    const t = new ThrottledAlert(target, async () => redis, { cooldownMs: 60_000 });

    await t.notify(ALERT);
    await t.notify({ ...ALERT, key: 'telegram-poller-down' });

    expect(target.notify).toHaveBeenCalledTimes(2);
  });

  // Redis mati SAAT sistem sekarat = justru saat alert paling dibutuhkan.
  it('Redis gagal → alert TETAP dikirim (fail-open), dicatat', async () => {
    const target = inner();
    const errors: string[] = [];
    const t = new ThrottledAlert(
      target,
      async () => {
        throw new Error('redis down');
      },
      { cooldownMs: 60_000, logger: { error: (m) => errors.push(m) } },
    );

    await t.notify(ALERT);

    expect(target.notify).toHaveBeenCalledTimes(1);
    expect(errors.some((e) => e.includes('redis down'))).toBe(true);
  });

  // Insiden P0 2026-07-12: perintah pada koneksi `maxRetriesPerRequest: null` MENGANTRE tanpa
  // reject saat Redis tak terjangkau → tanpa deadline, notify() menggantung dan alert mati
  // persis saat paling dibutuhkan.
  it('SET yang TAK PERNAH selesai → alert tetap dikirim pada deadline (bukan menggantung)', async () => {
    vi.useFakeTimers();
    try {
      const target = inner();
      const errors: string[] = [];
      const macet = {
        incr: vi.fn(),
        pexpire: vi.fn(),
        set: () => new Promise<string | null>(() => undefined), // menggantung selamanya
      } as unknown as RedisRateCommands;
      const t = new ThrottledAlert(target, async () => macet, {
        cooldownMs: 60_000,
        deadlineMs: 2_000,
        logger: { error: (m) => errors.push(m) },
      });

      const pending = t.notify(ALERT);
      await vi.advanceTimersByTimeAsync(2_001);
      await pending;

      expect(target.notify).toHaveBeenCalledTimes(1); // fail-open: alert tetap keluar
      expect(errors.some((e) => e.includes('REDIS_DEADLINE'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MultiAlert — satu kanal gagal tak membungkam yang lain', () => {
  it('satu gagal, satu sukses → tetap ok (tujuannya: PO TAHU)', async () => {
    const gagal: AlertPort = { notify: vi.fn(async () => err({ code: 'SEND' as const, message: 'x' })) };
    const sukses: AlertPort = { notify: vi.fn(async () => ok(undefined)) };

    const res = await new MultiAlert([gagal, sukses]).notify(ALERT);

    expect(res.ok).toBe(true);
    expect(sukses.notify).toHaveBeenCalled();
  });

  it('SEMUA kanal gagal → err', async () => {
    const gagal: AlertPort = { notify: vi.fn(async () => err({ code: 'SEND' as const, message: 'x' })) };

    const res = await new MultiAlert([gagal, gagal]).notify(ALERT);

    expect(res.ok).toBe(false);
  });
});

describe('WebhookAlert (n8n, ADR-7)', () => {
  it('POST payload alert + timeout (tak boleh menggantung jalur kegagalan)', async () => {
    const fetch = vi.fn(async () => ({ status: 200 }));
    const res = await new WebhookAlert({ url: 'https://n8n.test/hook', fetch: fetch as never }).notify(ALERT);

    expect(res.ok).toBe(true);
    const [, init] = fetch.mock.calls[0] as unknown as [string, { body: string; signal?: AbortSignal }];
    expect(JSON.parse(init.body)).toMatchObject({ key: ALERT.key, severity: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('HTTP non-2xx → err', async () => {
    const fetch = vi.fn(async () => ({ status: 500 }));
    const res = await new WebhookAlert({ url: 'https://n8n.test/hook', fetch: fetch as never }).notify(ALERT);

    expect(res.ok).toBe(false);
  });
});
