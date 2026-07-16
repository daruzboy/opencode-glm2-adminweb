import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import { quotaExhaustedReply, rateLimitedReply } from '@digimaestro/core';
import { handleIncoming, stubReply } from '../handle-incoming.js';
import { conv, makeFakeDeps } from './helpers.js';

describe('handleIncoming — web chat use case (NFR-09: tenantId selalu scoped)', () => {
  it('creates a new WEB conversation when no conversationId; persists IN then OUT', async () => {
    const f = makeFakeDeps();
    const r = await handleIncoming(f.deps, { tenantId: tenantId('tA'), text: 'hai' });

    expect(r.ok).toBe(true);
    expect(f.conversations.findById).not.toHaveBeenCalled();
    expect(f.conversations.create).toHaveBeenCalledWith(tenantId('tA'), { channel: 'WEB' });
    expect(f.messages.create).toHaveBeenCalledTimes(2);
    expect((f.messages.create.mock.calls[0]![1] as { direction: string }).direction).toBe('IN');
    expect((f.messages.create.mock.calls[1]![1] as { direction: string }).direction).toBe('OUT');
  });

  it('reuses existing conversation when findById returns it (no new create)', async () => {
    const f = makeFakeDeps();
    f.conversations.findById.mockResolvedValueOnce(ok(conv('c-exist')));

    const r = await handleIncoming(f.deps, {
      tenantId: tenantId('tA'),
      conversationId: 'c-exist',
      text: 'hai',
    });

    expect(r.ok).toBe(true);
    expect(f.conversations.create).not.toHaveBeenCalled();
    expect((f.messages.create.mock.calls[0]![1] as { conversationId: string }).conversationId).toBe(
      'c-exist',
    );
  });

  it('treats stale conversationId (not found) as a new conversation', async () => {
    const f = makeFakeDeps();
    f.conversations.findById.mockResolvedValueOnce(ok(null));

    const r = await handleIncoming(f.deps, {
      tenantId: tenantId('tA'),
      conversationId: 'stale',
      text: 'hai',
    });

    expect(r.ok).toBe(true);
    expect(f.conversations.create).toHaveBeenCalled();
  });

  it('passes the caller tenantId to EVERY repo call (no cross-tenant leak)', async () => {
    const f = makeFakeDeps();
    await handleIncoming(f.deps, { tenantId: tenantId('tA'), text: 'hai' });

    const convTids = f.conversations.create.mock.calls.map((c) => String(c[0]));
    const msgTids = f.messages.create.mock.calls.map((c) => String(c[0]));
    expect(convTids.every((t) => t === 'tA')).toBe(true);
    expect(msgTids.every((t) => t === 'tA')).toBe(true);
  });

  it('propagates repository error as Result.err', async () => {
    const f = makeFakeDeps();
    f.messages.create.mockResolvedValueOnce(err({ code: 'UNKNOWN', message: 'db down' }));

    const r = await handleIncoming(f.deps, { tenantId: tenantId('tA'), text: 'hai' });

    expect(r.ok).toBe(false);
  });
});

describe('handleIncoming — agent replier (T-053)', () => {
  it('memakai teks dari deps.reply saat disuntikkan', async () => {
    const f = makeFakeDeps();
    const reply = vi.fn().mockResolvedValue(ok({ text: 'balasan agent' }));

    const r = await handleIncoming(
      { ...f.deps, reply: { reply } },
      { tenantId: tenantId('tA'), text: 'mau buat web' },
    );

    expect(r.ok).toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ text: 'mau buat web' }));
    // pesan OUT (call ke-2) memakai teks agent
    expect((f.messages.create.mock.calls[1]![1] as { text: string }).text).toBe('balasan agent');
  });

  it('fallback ke stubReply saat deps.reply mengembalikan error', async () => {
    const f = makeFakeDeps();
    const reply = vi.fn().mockResolvedValue(err({ code: 'AGENT', message: 'loop gagal' }));

    const r = await handleIncoming(
      { ...f.deps, reply: { reply } },
      { tenantId: tenantId('tA'), text: 'halo' },
    );

    expect(r.ok).toBe(true);
    expect((f.messages.create.mock.calls[1]![1] as { text: string }).text).toBe(stubReply('halo'));
  });

  it('meneruskan tenantId & conversationId ke replier (NFR-09)', async () => {
    const f = makeFakeDeps();
    f.conversations.create.mockResolvedValueOnce(ok(conv('c-real')));
    const reply = vi.fn().mockResolvedValue(ok({ text: 'ok' }));

    await handleIncoming(
      { ...f.deps, reply: { reply } },
      { tenantId: tenantId('tB'), text: 'hai' },
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenantId('tB'), conversationId: 'c-real' }),
    );
  });
});

// Audit 2026-07-16: gerbang biaya web chat — paritas dgn jalur Telegram (core handle-inbound).
describe('handleIncoming — gerbang rate limit & kuota SEBELUM LLM', () => {
  const allowedRate = { allowed: true, shouldWarn: false, retryAfterSec: 60 };
  const blockedRate = { allowed: false, shouldWarn: true, retryAfterSec: 42 };

  it('rate limited → balas rateLimitedReply, LLM & kuota TIDAK disentuh', async () => {
    const f = makeFakeDeps();
    const reply = vi.fn();
    const quota = { check: vi.fn(), consume: vi.fn() };
    const rateLimiter = { check: vi.fn().mockResolvedValue(blockedRate) };

    const r = await handleIncoming(
      { ...f.deps, reply: { reply }, rateLimiter, quota },
      { tenantId: tenantId('tA'), text: 'spam' },
    );

    expect(r.ok).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    expect(quota.check).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    // pesan OUT (call ke-2) berisi teks rate-limit
    expect((f.messages.create.mock.calls[1]![1] as { text: string }).text).toBe(rateLimitedReply(42));
  });

  it('kuota habis → balas quotaExhaustedReply(reason), LLM tak dipanggil & TIDAK dikonsumsi', async () => {
    const f = makeFakeDeps();
    const reply = vi.fn();
    const quota = {
      check: vi.fn().mockResolvedValue(ok({ allowed: false, reason: 'TRIAL_EXPIRED', remaining: 0 })),
      consume: vi.fn(),
    };

    const r = await handleIncoming(
      { ...f.deps, reply: { reply }, quota },
      { tenantId: tenantId('tA'), text: 'halo' },
    );

    expect(r.ok).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
    expect((f.messages.create.mock.calls[1]![1] as { text: string }).text).toBe(
      quotaExhaustedReply('TRIAL_EXPIRED'),
    );
  });

  it('lolos gerbang → kuota dikonsumsi SEBELUM LLM, lalu balasan agent seperti biasa', async () => {
    const f = makeFakeDeps();
    const order: string[] = [];
    const reply = vi.fn().mockImplementation(async () => {
      order.push('llm');
      return ok({ text: 'balasan agent' });
    });
    const quota = {
      check: vi.fn().mockResolvedValue(ok({ allowed: true, remaining: 99 })),
      consume: vi.fn().mockImplementation(async () => {
        order.push('consume');
        return ok(undefined);
      }),
    };
    const rateLimiter = { check: vi.fn().mockResolvedValue(allowedRate) };

    const r = await handleIncoming(
      { ...f.deps, reply: { reply }, rateLimiter, quota },
      { tenantId: tenantId('tA'), text: 'mau buat web' },
    );

    expect(r.ok).toBe(true);
    expect(rateLimiter.check).toHaveBeenCalledWith(tenantId('tA'));
    expect(order).toEqual(['consume', 'llm']);
    expect((f.messages.create.mock.calls[1]![1] as { text: string }).text).toBe('balasan agent');
  });

  it('quota.check gagal (DB) → Result.err diteruskan', async () => {
    const f = makeFakeDeps();
    const quota = {
      check: vi.fn().mockResolvedValue(err({ code: 'UNKNOWN', message: 'db down' })),
      consume: vi.fn(),
    };

    const r = await handleIncoming(
      { ...f.deps, quota },
      { tenantId: tenantId('tA'), text: 'halo' },
    );

    expect(r.ok).toBe(false);
  });
});
