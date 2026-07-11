import { describe, expect, it, vi } from 'vitest';
import { ok, tenantId } from '@digimaestro/shared';
import {
  failedPublishMessage,
  livePublishMessage,
  notifyPublishOutcome,
  type NotifyDeps,
} from './notify-publish.js';

const TENANT = tenantId('t1');

function conv(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    tenantId: 't1',
    channel: 'TELEGRAM',
    externalId: '555',
    state: 'IDLE',
    escalatedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function fakeDeps(over: { convs?: unknown[]; send?: unknown; createMsg?: unknown } = {}) {
  const sendText = (over.send as never) ?? vi.fn(async () => ok({ providerMsgId: 'tg-555-9' }));
  return {
    deps: {
      conversations: {
        findMany: vi.fn(async () => ok((over.convs ?? [conv()]) as never)),
      },
      messages: {
        create: over.createMsg ?? vi.fn(async () => ok({ id: 'm1' })),
      },
      channel: { channel: 'TELEGRAM', sendText, sendButtons: vi.fn(), answerCallback: vi.fn() },
    } as unknown as NotifyDeps,
    sendText: sendText as ReturnType<typeof vi.fn>,
  };
}

describe('notifyPublishOutcome — situs sudah live', () => {
  it('kirim kabar + URL ke chat tenant', async () => {
    const { deps, sendText } = fakeDeps();

    const res = await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://warung.digimaestro.id' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.notified).toBe(true);
    expect(sendText).toHaveBeenCalledWith('555', livePublishMessage('https://warung.digimaestro.id'));
  });

  // Hanya percakapan kanal yang dipakai untuk mengabari yang dicari (bukan semua).
  it('mencari percakapan di kanal notifikasi saja', async () => {
    const { deps } = fakeDeps();

    await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://x.id' },
    });

    expect(deps.conversations.findMany).toHaveBeenCalledWith(TENANT, { channel: 'TELEGRAM' });
  });

  // Notifikasi juga tercatat di riwayat → pengguna melihatnya di transkrip, bukan cuma push.
  it('kabar dicatat sebagai pesan OUT', async () => {
    const createMsg = vi.fn(async () => ok({ id: 'm1' }));
    const { deps } = fakeDeps({ createMsg });

    await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://x.id' },
    });

    expect(createMsg).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ direction: 'OUT', status: 'SENT', conversationId: 'c1' }),
    );
  });
});

describe('notifyPublishOutcome — gagal terbit', () => {
  it('kirim alasan + tegaskan draft aman', async () => {
    const { deps, sendText } = fakeDeps();

    const res = await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'failed', reason: 'DEPLOY: koneksi cPanel putus' },
    });

    expect(res.ok).toBe(true);
    const [, text] = sendText.mock.calls[0] as [string, string];
    expect(text).toBe(failedPublishMessage('DEPLOY: koneksi cPanel putus'));
    expect(text).toContain('Draft kamu aman');
  });
});

describe('notifyPublishOutcome — tak ada yang bisa dikabari', () => {
  // Tenant web-only: tak ada chat_id → bukan error, memang tak ada tujuan push.
  it('tenant tanpa percakapan kanal → notified:false, tidak mengirim', async () => {
    const { deps, sendText } = fakeDeps({ convs: [] });

    const res = await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://x.id' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.notified).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('percakapan tanpa externalId (WEB) → dilewati', async () => {
    const { deps, sendText } = fakeDeps({ convs: [conv({ channel: 'WEB', externalId: null })] });

    const res = await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://x.id' },
    });

    expect(res.ok && res.value.notified).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('kirim gagal → pesan OUT dicatat FAILED (tidak mengaku terkirim)', async () => {
    const send = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'NETWORK' as const, message: 'telegram down' },
    }));
    const createMsg = vi.fn(async () => ok({ id: 'm1' }));
    const { deps } = fakeDeps({ send, createMsg });

    const res = await notifyPublishOutcome(deps, {
      tenantId: TENANT,
      notice: { kind: 'live', url: 'https://x.id' },
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sent).toBe(false);
    expect(createMsg).toHaveBeenCalledWith(TENANT, expect.objectContaining({ status: 'FAILED' }));
  });
});
