import { describe, expect, it, vi } from 'vitest';
import { TELEGRAM_MAX_TEXT, TelegramChannel, truncateForTelegram } from '../telegram-channel.js';

function fakeFetch(res: { status: number; body?: unknown }) {
  return vi.fn(async () => ({
    status: res.status,
    json: async () => res.body ?? {},
  })) as never;
}

function channel(fetch: never) {
  return new TelegramChannel({ botToken: 'rahasia', fetch });
}

const okBody = { ok: true, result: { message_id: 77, chat: { id: 555 } } };

describe('TelegramChannel.sendText', () => {
  it('sukses → providerMsgId dari respons Telegram', async () => {
    const fetch = fakeFetch({ status: 200, body: okBody });
    const res = await channel(fetch).sendText('555', 'halo');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.providerMsgId).toBe('tg-555-77');

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain('/botrahasia/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '555', text: 'halo' });
  });

  // Bot API bisa membalas HTTP 200 dengan ok:false — sukses HTTP ≠ pesan terkirim.
  it('HTTP 200 tapi ok:false → err (tidak dianggap terkirim)', async () => {
    const fetch = fakeFetch({ status: 200, body: { ok: false, description: 'chat not found' } });
    const res = await channel(fetch).sendText('555', 'halo');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('UNKNOWN');
      expect(res.error.message).toContain('chat not found');
    }
  });

  it('429 → RATE_LIMIT; 401/403 → AUTH', async () => {
    const limited = await channel(fakeFetch({ status: 429 })).sendText('1', 'x');
    const unauthorized = await channel(fakeFetch({ status: 401 })).sendText('1', 'x');
    const forbidden = await channel(fakeFetch({ status: 403 })).sendText('1', 'x');

    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.code).toBe('RATE_LIMIT');
    if (!unauthorized.ok) expect(unauthorized.error.code).toBe('AUTH');
    if (!forbidden.ok) expect(forbidden.error.code).toBe('AUTH');
  });

  it('fetch melempar (jaringan mati) → NETWORK, bukan crash', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;
    const res = await channel(fetch).sendText('1', 'x');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NETWORK');
  });

  it('teks melebihi 4096 char dipotong (API menolak pesan kepanjangan)', async () => {
    const fetch = fakeFetch({ status: 200, body: okBody });
    await channel(fetch).sendText('555', 'a'.repeat(5000));

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const sent = JSON.parse(init.body) as { text: string };
    expect(sent.text.length).toBe(TELEGRAM_MAX_TEXT);
    expect(sent.text.endsWith('…')).toBe(true);
  });

  it('teks pendek tidak diubah', () => {
    expect(truncateForTelegram('halo')).toBe('halo');
  });
});

// T-031tg: tombol interaktif + jawaban callback.
describe('TelegramChannel.sendButtons / answerCallback', () => {
  it('tombol dikirim sebagai inline_keyboard (satu tombol per baris)', async () => {
    const fetch = fakeFetch({ status: 200, body: okBody });
    const res = await channel(fetch).sendButtons('555', 'Situsmu jadi!', [
      { label: '✅ Setuju & publish', action: 'pub:2' },
      { label: '✏️ Minta revisi', action: 'rev:2' },
    ]);

    expect(res.ok).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain('/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({
      chat_id: '555',
      text: 'Situsmu jadi!',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Setuju & publish', callback_data: 'pub:2' }],
          [{ text: '✏️ Minta revisi', callback_data: 'rev:2' }],
        ],
      },
    });
  });

  // Telegram menolak callback_data > 64 byte — lebih baik gagal keras daripada mengirim
  // pesan yang tombolnya tak berfungsi.
  it('callback_data > 64 byte → err, tidak dikirim', async () => {
    const fetch = fakeFetch({ status: 200, body: okBody });
    const res = await channel(fetch).sendButtons('555', 'x', [
      { label: 'panjang', action: 'pub:' + '9'.repeat(70) },
    ]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toContain('64 byte');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answerCallback memanggil answerCallbackQuery (agar tombol berhenti berputar)', async () => {
    const fetch = fakeFetch({ status: 200, body: { ok: true, result: true } });
    const res = await channel(fetch).answerCallback('cb-9', 'Oke!');

    expect(res.ok).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toContain('/answerCallbackQuery');
    expect(JSON.parse(init.body)).toMatchObject({ callback_query_id: 'cb-9', text: 'Oke!' });
  });
});
