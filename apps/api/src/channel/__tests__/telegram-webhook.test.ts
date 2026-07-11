import { describe, expect, it, vi } from 'vitest';
import { ok, err, type ChatInboundQueuePort } from '@digimaestro/shared';
import { buildServer } from '../../index.js';
import { TELEGRAM_SECRET_HEADER, type TelegramWebhookDeps } from '../telegram-webhook.js';

const SECRET = 'secret-webhook-abc';
const CHAT_TERDAFTAR = 8037867441;
const CHAT_ASING = 1234567;

function fakeQueue(): ChatInboundQueuePort & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async enqueueInbound(job) {
      calls.push(job);
      return ok({ jobId: 'job-1' });
    },
  };
}

function deps(over: Partial<TelegramWebhookDeps> = {}): TelegramWebhookDeps {
  return {
    queue: over.queue ?? fakeQueue(),
    secretToken: SECRET,
    allowlistRaw: over.allowlistRaw ?? `${CHAT_TERDAFTAR}:tenant-darusman`,
  };
}

function update(chatId: number, text = 'halo') {
  return { update_id: 1, message: { message_id: 10, chat: { id: chatId }, text } };
}

async function post(telegram: TelegramWebhookDeps, payload: unknown, secret?: string) {
  const app = await buildServer({ telegram });
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/telegram',
    headers: secret === undefined ? {} : { [TELEGRAM_SECRET_HEADER]: secret },
    payload: payload as never,
  });
  await app.close();
  return res;
}

describe('POST /api/webhooks/telegram — keaslian', () => {
  // Endpoint ini publik (Telegram harus bisa memanggilnya); secret token = satu-satunya
  // bukti bahwa pemanggilnya benar Telegram.
  it('tanpa header secret → 401 & tidak di-enqueue', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), update(CHAT_TERDAFTAR));

    expect(res.statusCode).toBe(401);
    expect(queue.calls).toHaveLength(0);
  });

  it('secret salah → 401 & tidak di-enqueue', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), update(CHAT_TERDAFTAR), 'secret-palsu-xx');

    expect(res.statusCode).toBe(401);
    expect(queue.calls).toHaveLength(0);
  });
});

describe('POST /api/webhooks/telegram — allowlist (gerbang biaya LLM)', () => {
  it('chat terdaftar → 200 + di-enqueue dengan tenant dari allowlist', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), update(CHAT_TERDAFTAR), SECRET);

    expect(res.statusCode).toBe(200);
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({
      tenantId: 'tenant-darusman',
      message: { channel: 'TELEGRAM', externalId: String(CHAT_TERDAFTAR), text: 'halo' },
    });
  });

  // Bot Telegram terbuka: orang asing bisa menemukannya. Harus berhenti SEBELUM LLM.
  it('chat di luar allowlist → 200 (agar tak di-retry) tapi TIDAK di-enqueue', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), update(CHAT_ASING), SECRET);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: 'chat tidak terdaftar' });
    expect(queue.calls).toHaveLength(0);
  });

  it('allowlist kosong → semua chat ditolak', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue, allowlistRaw: '' }), update(CHAT_TERDAFTAR), SECRET);

    expect(res.statusCode).toBe(200);
    expect(queue.calls).toHaveLength(0);
  });
});

describe('POST /api/webhooks/telegram — payload & kegagalan', () => {
  // Telegram me-retry update yang dijawab non-2xx → membalas error untuk update yang
  // memang kita abaikan akan memicu kiriman ulang tanpa akhir.
  it('update bukan pesan (mis. callback_query) → 200, tidak di-enqueue', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), { update_id: 5, callback_query: { id: 'x' } }, SECRET);

    expect(res.statusCode).toBe(200);
    expect(queue.calls).toHaveLength(0);
  });

  it('payload ngawur → 200, tidak di-enqueue', async () => {
    const queue = fakeQueue();
    const res = await post(deps({ queue }), { bukan: 'update telegram' }, SECRET);

    expect(res.statusCode).toBe(200);
    expect(queue.calls).toHaveLength(0);
  });

  // Kalau gagal enqueue dijawab 200, pesan pengguna HILANG diam-diam.
  it('gagal enqueue → 500 supaya Telegram mengirim ulang', async () => {
    const queue: ChatInboundQueuePort = {
      enqueueInbound: vi.fn(async () => err({ code: 'QUEUE' as const, message: 'redis mati' })),
    };
    const res = await post(deps({ queue }), update(CHAT_TERDAFTAR), SECRET);

    expect(res.statusCode).toBe(500);
  });
});

describe('webhook tidak terpasang bila tidak dikonfigurasi', () => {
  it('tanpa deps telegram → rute tak ada (404)', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/telegram', payload: {} });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
