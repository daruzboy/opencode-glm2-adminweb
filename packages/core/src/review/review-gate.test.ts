// P5: gerbang review PO — aturan gerbang + penyelesaian review. Semua offline (fake port).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import { completeAdminReview, needsAdminReview, type ReviewCompleteDeps } from './review-gate.js';

const T = tenantId('t1');

describe('needsAdminReview — aturan O(1)', () => {
  it.each([
    ['build pertama (approved null)', 'tpl-a', null, true],
    ['ganti template', 'tpl-b', 'tpl-a', true],
    ['template sama (perubahan isi)', 'tpl-a', 'tpl-a', false],
    ['legacy sections-v1 (tanpa templateId)', null, null, false],
  ])('%s → %s', (_nama, revTpl, approved, expected) => {
    expect(needsAdminReview(revTpl, approved)).toBe(expected);
  });
});

const PENDING_REV = {
  id: 'r1',
  websiteId: 'w1',
  number: 3,
  siteDoc: {},
  summary: null,
  status: 'PENDING_ADMIN_REVIEW' as const,
  createdBy: 'agent',
  renderEngine: 'mobirise-v1',
  templateId: 'tpl-a',
  editorProjectId: 'proj-9',
  createdAt: '',
  updatedAt: '',
};

const DOC = { templateId: 'tpl-a', styling: {}, pages: [{ slug: 'index', title: 'x', components: [{}] }] };

function deps(over: Partial<Record<keyof ReviewCompleteDeps | 'rev', unknown>> = {}): ReviewCompleteDeps & {
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    create: vi.fn(async (_t: unknown, input: Record<string, unknown>) => ok({ ...PENDING_REV, id: 'r2', number: 4, ...input })),
    update: vi.fn(async () => ok({} as never)),
    sendButtons: vi.fn(async () => ok({ providerMsgId: 'tg-1' })),
    msgCreate: vi.fn(async () => ok({} as never)),
  };
  return {
    spies,
    revisions: {
      findById: vi.fn(async () => ok((over.rev as typeof PENDING_REV) ?? PENDING_REV)),
      findLatest: vi.fn(),
      create: spies.create,
      update: vi.fn(async () => ok(PENDING_REV)),
    } as never,
    websites: { findByTenantId: vi.fn(), create: vi.fn(), update: spies.update } as never,
    conversations: {
      findMany: vi.fn(async () => ok([{ id: 'c1', externalId: '555', channel: 'TELEGRAM' }])),
    } as never,
    messages: { create: spies.msgCreate, findManyByConversation: vi.fn() } as never,
    channel: { channel: 'TELEGRAM', sendText: vi.fn(), sendButtons: spies.sendButtons, answerCallback: vi.fn() } as never,
    parseDocument: () => ({ ok: true }),
    ...(over as object),
  } as never;
}

const CMD = { tenantId: T, websiteId: 'w1', revisionId: 'r1', editorProjectId: 'proj-9', document: DOC };

describe('completeAdminReview', () => {
  it('dokumen EDITAN dibekukan jadi revisi baru + approvedTemplateId diset + pelanggan dapat tombol', async () => {
    const d = deps();
    const res = await completeAdminReview(d, CMD);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.customerNotified).toBe(true);
    // Revisi baru dari dokumen EDITAN (bukan siteDoc revisi pending).
    expect(d.spies.create).toHaveBeenCalledWith(
      T,
      expect.objectContaining({ siteDoc: DOC, renderEngine: 'mobirise-v1', templateId: 'tpl-a', createdBy: 'admin-review' }),
    );
    // Template kini lolos review untuk tenant ini.
    expect(d.spies.update).toHaveBeenCalledWith(T, 'w1', { approvedTemplateId: 'tpl-a' });
    // Pelanggan tetap gerbang akhir: tombol approval dikirim.
    expect(d.spies.sendButtons).toHaveBeenCalled();
  });

  it('editorProjectId TIDAK cocok → CORRELATION (panggilan palsu tak memajukan situs)', async () => {
    const res = await completeAdminReview(deps(), { ...CMD, editorProjectId: 'proj-palsu' });
    expect(!res.ok && res.error.code).toBe('CORRELATION');
  });

  it('revisi bukan PENDING_ADMIN_REVIEW → CORRELATION (approve dobel tak menggandakan)', async () => {
    const d = deps({ rev: { ...PENDING_REV, status: 'DRAFT' } });
    const res = await completeAdminReview(d, CMD);
    expect(!res.ok && res.error.code).toBe('CORRELATION');
    expect(d.spies.create).not.toHaveBeenCalled();
  });

  it('dokumen editan tak valid → INVALID, berhenti SEBELUM menyentuh DB', async () => {
    const d = deps({ parseDocument: () => ({ ok: false, message: 'pages kosong' }) });
    const res = await completeAdminReview(d, CMD);
    expect(!res.ok && res.error.code).toBe('INVALID');
    expect(d.spies.create).not.toHaveBeenCalled();
  });

  it('tenant tanpa percakapan Telegram → sukses dgn customerNotified=false (bukan gagal)', async () => {
    const d = deps({ conversations: { findMany: vi.fn(async () => ok([])) } as never });
    const res = await completeAdminReview(d, CMD);
    expect(res.ok && res.value.customerNotified).toBe(false);
  });

  it('kirim tombol GAGAL → tetap sukses (revisi sudah dibekukan), dicatat', async () => {
    const errors: string[] = [];
    const d = deps({
      channel: {
        channel: 'TELEGRAM',
        sendText: vi.fn(),
        sendButtons: vi.fn(async () => err({ code: 'NETWORK', message: 'putus' })),
        answerCallback: vi.fn(),
      } as never,
      logger: { error: (m: string) => errors.push(m) },
    });
    const res = await completeAdminReview(d, CMD);
    expect(res.ok && res.value.customerNotified).toBe(false);
    expect(errors.some((e) => e.includes('putus'))).toBe(true);
  });
});
