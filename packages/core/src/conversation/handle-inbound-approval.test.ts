// T-031tg: tombol interaktif — build → tombol approval → tap "Setuju" → publish (BRU-02).
import { describe, expect, it, vi } from 'vitest';
import { ok, tenantId } from '@digimaestro/shared';
import type { InboundChannelMessage } from '@digimaestro/shared';
import { handleInboundMessage, type ApprovalDeps, type InboundDeps } from './handle-inbound.js';

const TENANT = tenantId('t1');

const website = {
  id: 'w1',
  tenantId: 't1',
  slug: 'warung-sari',
  status: 'DRAFTING',
  publishedRevisionId: null,
  themeId: null,
  deploymentTargetId: null,
  createdAt: '',
  updatedAt: '',
};

function revision(number: number) {
  return {
    id: `r${number}`,
    tenantId: 't1',
    websiteId: 'w1',
    number,
    siteDoc: {},
    summary: 's',
    status: 'DRAFT',
    createdBy: 'agent',
    createdAt: '',
  };
}

const textMsg: InboundChannelMessage = {
  channel: 'TELEGRAM',
  externalId: '555',
  providerMsgId: 'tg-555-1',
  type: 'TEXT',
  text: 'bikinin website warung',
};

function tapMsg(action: string, id = 'cb-1'): InboundChannelMessage {
  return {
    channel: 'TELEGRAM',
    externalId: '555',
    providerMsgId: `tg-cb-${id}`,
    type: 'INTERACTIVE',
    callbackId: id,
    callbackData: action,
  };
}

interface Opts {
  // Nomor revisi terbaru yang dikembalikan repo, berurutan tiap panggilan findLatest.
  latest?: (number | null)[];
  publishOutcome?: 'ok' | '404' | '500';
  createMsg?: unknown;
  withApproval?: boolean;
  previewUrl?: boolean;
  // Preview PUBLIK: token folder pratinjau → build di-enqueue mode 'preview'.
  previewToken?: boolean;
  enqueueErr?: boolean;
}

function build(opts: Opts = {}) {
  const enqueuePublish = vi.fn(async () =>
    opts.enqueueErr
      ? { ok: false as const, error: { code: 'QUEUE' as const, message: 'redis down' } }
      : ok({ jobId: 'job-1' }),
  );
  const sendButtons = vi.fn(async () => ok({ providerMsgId: 'tg-555-2' }));
  const sendText = vi.fn(async () => ok({ providerMsgId: 'tg-555-3' }));
  const answerCallback = vi.fn(async () => ok(undefined));

  const seq = [...(opts.latest ?? [null, null])];
  const findLatest = vi.fn(async () => {
    const n = seq.length > 1 ? seq.shift() : seq[0];
    return ok(n === null || n === undefined ? null : revision(n));
  });

  const getPublishSource = vi.fn(async () => {
    if (opts.publishOutcome === '404') return ok(null);
    if (opts.publishOutcome === '500') {
      return { ok: false as const, error: { code: 'UNKNOWN' as const, message: 'db mati' } };
    }
    return ok({ websiteId: 'w1', revisionNumber: 2, slug: 'warung-sari', siteDocument: {} });
  });

  const approval: ApprovalDeps = {
    websites: { findByTenantId: vi.fn(async () => ok(website)) } as never,
    revisions: { findLatest } as never,
    publish: {
      source: { getPublishSource } as never,
      queue: { enqueuePublish } as never,
      rootDomain: 'digimaestro.id',
    },
    ...(opts.previewUrl ? { previewUrl: (id: string) => `https://api.test/api/preview/${id}?t=tok` } : {}),
    ...(opts.previewToken ? { previewToken: () => 'tok123' } : {}),
  };

  const deps = {
    conversations: {
      findByExternalId: vi.fn(async () => ok({ id: 'c1' })),
      create: vi.fn(async () => ok({ id: 'c1' })),
    },
    messages: {
      create: opts.createMsg ?? vi.fn(async () => ok({ id: 'm1' })),
    },
    channel: { channel: 'TELEGRAM', sendText, sendButtons, answerCallback },
    reply: { reply: vi.fn(async () => ok({ text: 'Situsmu sudah jadi!' })) },
    ...(opts.withApproval === false ? {} : { approval }),
  } as unknown as InboundDeps;

  return { deps, sendButtons, sendText, answerCallback, enqueuePublish, getPublishSource };
}

describe('tombol approval muncul setelah revisi baru dibangun', () => {
  // Deteksi berbasis NOMOR REVISI (bukan menebak dari teks LLM): sebelum=null → sesudah=1.
  it('agent membangun revisi → balasan + tombol pub/rev', async () => {
    const { deps, sendButtons } = build({ latest: [null, 1] });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.revisionNumber).toBe(1);
    expect(sendButtons).toHaveBeenCalledTimes(1);
    const [, , buttons] = sendButtons.mock.calls[0] as [string, string, { action: string }[]];
    // Sidik tenant (konsol admin 2026-07-15) ikut di callback.
    expect(buttons.map((b) => b.action)).toEqual(['pub:1:t1', 'rev:1:t1']);
  });

  it('tautan preview disisipkan bila dikonfigurasi', async () => {
    const { deps, sendButtons } = build({ latest: [null, 1], previewUrl: true });

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    const [, text] = sendButtons.mock.calls[0] as [string, string];
    expect(text).toContain('https://api.test/api/preview/r1?t=tok');
  });

  // Ngobrol biasa tanpa build → jangan spam tombol tiap pesan.
  it('tanpa revisi baru → teks biasa, tanpa tombol', async () => {
    const { deps, sendButtons, sendText } = build({ latest: [1, 1] });

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(sendButtons).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('tanpa approval deps → tetap membalas, tanpa tombol', async () => {
    const { deps, sendButtons, sendText } = build({ withApproval: false });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    expect(sendButtons).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalled();
  });
});

describe('tap tombol "Setuju & publish" (BRU-02)', () => {
  it('enqueue publish + jawab callback + kabari URL', async () => {
    const { deps, enqueuePublish, answerCallback, sendText } = build({ latest: [2] });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:2') });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.action).toBe('publish');
    expect(enqueuePublish).toHaveBeenCalledTimes(1);
    // Tombol harus dijawab, kalau tidak ia berputar terus di UI Telegram.
    expect(answerCallback).toHaveBeenCalledWith('cb-1', expect.any(String));
    const [, text] = sendText.mock.calls[0] as [string, string];
    expect(text).toContain('https://warung-sari.digimaestro.id');
  });

  // Paling berbahaya: dobel-tap tidak boleh publish dua kali. Ditahan providerMsgId @unique.
  it('tombol ditekan dua kali → publish HANYA sekali (idempoten)', async () => {
    const create = vi
      .fn()
      .mockImplementationOnce(async () => ok({ id: 'm1' }))
      .mockImplementationOnce(async () => ok({ id: 'm2' }))
      // Tap kedua: providerMsgId sama → CONFLICT dari DB.
      .mockImplementationOnce(async () => ({
        ok: false as const,
        error: { code: 'CONFLICT' as const, message: 'sudah tercatat' },
      }));
    const { deps, enqueuePublish } = build({ latest: [2], createMsg: create });

    const first = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:2') });
    const second = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:2') });

    expect(first.ok && first.value.duplicate).toBe(false);
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(enqueuePublish).toHaveBeenCalledTimes(1);
  });

  it('revisi tak ditemukan (404) → tidak enqueue, user diberi tahu', async () => {
    const { deps, enqueuePublish, sendText } = build({ latest: [2], publishOutcome: '404' });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:9') });

    expect(res.ok).toBe(true);
    expect(enqueuePublish).not.toHaveBeenCalled();
    const [, text] = sendText.mock.calls[0] as [string, string];
    expect(text).toContain('nggak ketemu');
  });

  it('sumber publish error (500) → tidak enqueue, user diberi tahu', async () => {
    const { deps, enqueuePublish } = build({ latest: [2], publishOutcome: '500' });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:2') });

    expect(res.ok).toBe(true);
    expect(enqueuePublish).not.toHaveBeenCalled();
  });

  // Nomor revisi dari tombol tetap diverifikasi ke DB tenant (PublishSourcePort) →
  // menempel nomor revisi tenant lain tak menemukan apa pun.
  it('nomor revisi dari tombol diteruskan ke sumber tepercaya, bukan dipercaya mentah', async () => {
    const { deps, getPublishSource } = build({ latest: [2] });

    await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('pub:2') });

    expect(getPublishSource).toHaveBeenCalledWith(TENANT, { websiteId: 'w1', revisionNumber: 2 });
  });
});

describe('tombol lain & payload karangan', () => {
  it('tap "Minta revisi" → ajakan menulis perubahan, tidak publish', async () => {
    const { deps, enqueuePublish, sendText } = build({ latest: [2] });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: tapMsg('rev:2') });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.action).toBe('revise');
    expect(enqueuePublish).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalled();
  });

  it('callback_data dikarang → tidak publish, tetap jawab callback', async () => {
    const { deps, enqueuePublish, answerCallback } = build({ latest: [2] });

    const res = await handleInboundMessage(deps, {
      tenantId: TENANT,
      message: tapMsg('hapus-semua:1'),
    });

    expect(res.ok).toBe(true);
    expect(enqueuePublish).not.toHaveBeenCalled();
    expect(answerCallback).toHaveBeenCalled();
  });
});


// Preview PUBLIK (2026-07-15): dengan previewToken, build TIDAK langsung mengirim tombol —
// pratinjau di-enqueue (mode preview) dan tombol datang dari worker setelah tayang.
describe('preview publik saat build (previewToken terpasang)', () => {
  it('build → enqueue job mode preview + pesan ekspektasi TANPA tombol', async () => {
    const { deps, sendButtons, sendText, enqueuePublish } = build({
      latest: [null, 1],
      previewToken: true,
    });

    const res = await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(res.ok).toBe(true);
    expect(enqueuePublish).toHaveBeenCalledTimes(1);
    const job = enqueuePublish.mock.calls[0]?.[0] as { mode?: string; slug?: string };
    expect(job.mode).toBe('preview');
    expect(job.slug).toBe('preview/warung-sari-tok123');
    expect(sendButtons).not.toHaveBeenCalled();
    const [, text] = sendText.mock.calls[0] as [string, string];
    expect(text).toContain('pratinjau');
  });

  it('enqueue pratinjau GAGAL → fallback jalur lama (tombol tetap terkirim)', async () => {
    const { deps, sendButtons } = build({ latest: [null, 1], previewToken: true, enqueueErr: true });

    await handleInboundMessage(deps, { tenantId: TENANT, message: textMsg });

    expect(sendButtons).toHaveBeenCalledTimes(1);
  });
});
