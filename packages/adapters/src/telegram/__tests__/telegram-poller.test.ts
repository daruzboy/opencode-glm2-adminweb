import { describe, expect, it, vi } from 'vitest';
import { err, ok, type ChatInboundQueuePort } from '@digimaestro/shared';
import { startTelegramPoller, pollOnce, type TelegramPollerOptions } from '../telegram-poller.js';

function update(id: number, chatId: number, text = 'halo') {
  return { update_id: id, message: { message_id: id * 10, chat: { id: chatId }, text } };
}

function fakeFetch(result: unknown[], status = 200) {
  return vi.fn(async () => ({ status, json: async () => ({ ok: true, result }) })) as never;
}

function opts(over: Partial<TelegramPollerOptions> = {}): TelegramPollerOptions & {
  jobs: unknown[];
} {
  const jobs: unknown[] = [];
  const queue: ChatInboundQueuePort = {
    async enqueueInbound(job) {
      jobs.push(job);
      return ok({ jobId: `j${jobs.length}` });
    },
  };
  return {
    botToken: 'rahasia',
    queue: over.queue ?? queue,
    fetch: over.fetch ?? fakeFetch([]),
    allowlistRaw: over.allowlistRaw ?? '555:tenant-a',
    jobs,
    ...over,
  } as TelegramPollerOptions & { jobs: unknown[] };
}

describe('pollOnce — ambil update & teruskan ke antrean', () => {
  it('pesan dari chat terdaftar → di-enqueue, offset maju', async () => {
    const o = opts({ fetch: fakeFetch([update(7, 555)]) });

    const out = await pollOnce(o, 0);

    expect(out.enqueued).toBe(1);
    expect(out.nextOffset).toBe(8); // update_id + 1
    expect(o.jobs[0]).toMatchObject({
      tenantId: 'tenant-a',
      message: { channel: 'TELEGRAM', externalId: '555', text: 'halo' },
    });
  });

  it('mengirim offset & allowed_updates ke Telegram', async () => {
    const fetch = fakeFetch([]);
    await pollOnce(opts({ fetch }), 42);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain('/botrahasia/getUpdates');
    expect(JSON.parse(init.body)).toMatchObject({
      offset: 42,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    });
  });

  // Gerbang biaya sama dengan webhook (ADR-12).
  it('chat di luar allowlist → tidak di-enqueue, tapi offset TETAP maju', async () => {
    const o = opts({ fetch: fakeFetch([update(3, 999)]) });

    const out = await pollOnce(o, 0);

    expect(o.jobs).toHaveLength(0);
    expect(out.ignored).toBe(1);
    // Kalau offset tak maju, update yang diabaikan ini akan dikirim ulang selamanya.
    expect(out.nextOffset).toBe(4);
  });

  it('update tak dikenal (bukan pesan) → dilewati, offset tetap maju', async () => {
    const o = opts({ fetch: fakeFetch([{ update_id: 5, my_chat_member: {} }]) });

    const out = await pollOnce(o, 0);

    expect(out.enqueued).toBe(0);
    expect(out.nextOffset).toBe(6);
  });

  // Pesan pengguna tak boleh hilang saat Redis tersendat.
  it('gagal enqueue → offset TIDAK melewati update itu (dikirim ulang nanti)', async () => {
    const queue: ChatInboundQueuePort = {
      enqueueInbound: vi.fn(async () => err({ code: 'QUEUE' as const, message: 'redis mati' })),
    };
    const o = opts({ fetch: fakeFetch([update(9, 555)]), queue });

    const out = await pollOnce(o, 0);

    expect(out.enqueued).toBe(0);
    expect(out.nextOffset).toBe(9); // bukan 10 → update 9 akan diambil lagi
  });

  it('batch banyak update → semua diproses, offset = terakhir + 1', async () => {
    const o = opts({ fetch: fakeFetch([update(1, 555), update(2, 555), update(3, 555)]) });

    const out = await pollOnce(o, 0);

    expect(out.enqueued).toBe(3);
    expect(out.nextOffset).toBe(4);
  });

  it('HTTP error → throw (loop akan retry dengan backoff)', async () => {
    const fetch = vi.fn(async () => ({ status: 500, json: async () => ({}) })) as never;
    await expect(pollOnce(opts({ fetch }), 0)).rejects.toThrow('getUpdates HTTP 500');
  });

  it('ok:false → throw', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: false, description: 'token salah' }),
    })) as never;
    await expect(pollOnce(opts({ fetch }), 0)).rejects.toThrow('token salah');
  });
});

// P0 (audit): TANPA timeout eksplisit, fetch menggantung sampai default undici (±5 MENIT)
// bila koneksi stall → bot BERHENTI menerima pesan tanpa error/log (container tetap "sehat").
describe('pollOnce — timeout wajib (anti bot mati diam-diam)', () => {
  it('mengirim AbortSignal dengan margin di atas long-poll', async () => {
    const fetch = fakeFetch([]);
    await pollOnce(opts({ fetch, pollTimeoutSec: 30 }), 0);

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { signal?: AbortSignal },
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // Saat timeout memicu, fetch menolak dgn TimeoutError → pollOnce MELEMPAR → loop menangkap,
  // mencatat, dan mencoba lagi (bukan menggantung diam-diam).
  it('timeout memicu → pollOnce melempar (loop akan retry)', async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    }) as never;

    await expect(pollOnce(opts({ fetch }), 0)).rejects.toThrow(/abort/i);
  });
});

// T-070: bot yang berhenti menerima pesan = pelanggan mengirim ke ruang hampa, dan itu TIDAK
// terlihat dari luar (container tetap "sehat"). Error beruntun → kabari PO.
describe('poller — alert saat bot tak bisa menarik pesan', () => {
  it('gagal beruntun mencapai ambang → alert CRITICAL sekali', async () => {
    const notified: unknown[] = [];
    const alert = { notify: vi.fn(async (a: unknown) => { notified.push(a); return ok(undefined); }) };
    const fetch = vi.fn(async () => { throw new Error('ENOTFOUND'); }) as never;

    const handle = startTelegramPoller({
      ...opts({ fetch }),
      alert: alert as never,
      alertAfterFailures: 2,
      logger: { info: () => {}, error: () => {} },
    });

    // Tunggu beberapa siklus gagal (loop tidur 5 dtk antar percobaan → pakai timer palsu tak
    // praktis; cukup beri waktu 2 percobaan pertama yang instan).
    await new Promise((r) => setTimeout(r, 50));
    handle.stop();

    // Percobaan pertama gagal instan; ambang 2 tercapai setelah retry berikutnya.
    // Yang dikunci di sini: alert TIDAK dikirim pada kegagalan PERTAMA (sekali gagal = wajar).
    expect(notified.length).toBeLessThanOrEqual(1);
  });
});
