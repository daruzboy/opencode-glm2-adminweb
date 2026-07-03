import { describe, expect, it } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import { handleIncoming } from '../handle-incoming.js';
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
