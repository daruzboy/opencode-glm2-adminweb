import { describe, expect, it, vi } from 'vitest';
import { ok, type ChannelPort } from '@digimaestro/shared';
import { RateLimitedChannel } from '../rate-limited-channel.js';

function innerChannel() {
  return {
    channel: 'TELEGRAM' as const,
    sendText: vi.fn(async () => ok({ providerMsgId: 'tg-1' })),
    sendButtons: vi.fn(async () => ok({ providerMsgId: 'tg-2' })),
    answerCallback: vi.fn(async () => ok(undefined)),
  } satisfies ChannelPort;
}

describe('RateLimitedChannel — batas kirim per chat/tenant', () => {
  it('di bawah batas → diteruskan ke kanal', async () => {
    const inner = innerChannel();
    const ch = new RateLimitedChannel(inner, { limit: 2, windowMs: 60_000, now: () => 1000 });

    expect((await ch.sendText('555', 'a')).ok).toBe(true);
    expect((await ch.sendText('555', 'b')).ok).toBe(true);
    expect(inner.sendText).toHaveBeenCalledTimes(2);
  });

  // Menahan banjir pesan (bug/loop agent) sebelum Telegram menghukum kita dengan 429.
  it('melewati batas → RATE_LIMIT & TIDAK memanggil Telegram', async () => {
    const inner = innerChannel();
    const ch = new RateLimitedChannel(inner, { limit: 2, windowMs: 60_000, now: () => 1000 });

    await ch.sendText('555', 'a');
    await ch.sendText('555', 'b');
    const third = await ch.sendText('555', 'c');

    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('RATE_LIMIT');
    expect(inner.sendText).toHaveBeenCalledTimes(2);
  });

  it('kuota terpisah per chat (tenant lain tak kena imbas)', async () => {
    const inner = innerChannel();
    const ch = new RateLimitedChannel(inner, { limit: 1, windowMs: 60_000, now: () => 1000 });

    await ch.sendText('555', 'a');
    const lain = await ch.sendText('777', 'a');

    expect(lain.ok).toBe(true);
  });

  it('jendela geser: kuota pulih setelah window lewat', async () => {
    const inner = innerChannel();
    let t = 1000;
    const ch = new RateLimitedChannel(inner, { limit: 1, windowMs: 60_000, now: () => t });

    await ch.sendText('555', 'a');
    expect((await ch.sendText('555', 'b')).ok).toBe(false);

    t += 60_001;
    expect((await ch.sendText('555', 'c')).ok).toBe(true);
  });

  it('tombol ikut dibatasi (kuota dibagi dengan teks)', async () => {
    const inner = innerChannel();
    const ch = new RateLimitedChannel(inner, { limit: 1, windowMs: 60_000, now: () => 1000 });

    await ch.sendText('555', 'a');
    const btn = await ch.sendButtons('555', 'b', [{ label: 'x', action: 'pub:1' }]);

    expect(btn.ok).toBe(false);
    expect(inner.sendButtons).not.toHaveBeenCalled();
  });

  // answerCallback = ACK teknis, bukan pesan ke pengguna. Menahannya membuat tombol
  // tampak menggantung justru saat tenant sedang kena limit.
  it('answerCallback TIDAK dibatasi', async () => {
    const inner = innerChannel();
    const ch = new RateLimitedChannel(inner, { limit: 1, windowMs: 60_000, now: () => 1000 });

    await ch.sendText('555', 'a');
    await ch.sendText('555', 'b'); // kena limit
    const ack = await ch.answerCallback('cb-1', 'oke');

    expect(ack.ok).toBe(true);
    expect(inner.answerCallback).toHaveBeenCalledTimes(1);
  });
});
