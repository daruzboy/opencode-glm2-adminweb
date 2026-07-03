import { describe, expect, it, vi } from 'vitest';
import type { Conversation as PrismaConversation } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';

import { ConversationRepositoryPrisma } from '../conversation-repo-prisma.js';
import type { ConversationDelegate } from '../conversation-repo-prisma.js';

function row(over: Partial<PrismaConversation> = {}): PrismaConversation {
  return {
    id: 'c1',
    tenantId: 'tA',
    channel: 'WA',
    state: 'ONBOARDING',
    escalatedAt: null,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
    ...over,
  } as PrismaConversation;
}

function makeDelegate(impl: {
  findFirst?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}): ConversationDelegate {
  return {
    findFirst: impl.findFirst ?? vi.fn(),
    findMany: impl.findMany ?? vi.fn(),
    create: impl.create ?? vi.fn(),
  } as unknown as ConversationDelegate;
}

describe('ConversationRepositoryPrisma — NFR-09: tenantId always scoped', () => {
  it('findById injects caller tenantId into where (happy path)', async () => {
    const findFirst = vi.fn().mockResolvedValue(row());
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findById(tenantId('tA'), 'c1');

    expect(r.ok).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tA', id: 'c1' } });
    if (r.ok) expect(r.value?.id).toBe('c1');
  });

  it('findById returns null (NO leak) when id belongs to another tenant', async () => {
    // Repo selalu menyuntik tenantId kaller ke `where`; DB tak bisa mengembalikan
    // row tenant lain → simulasi: delegate mengembalikan null (sebagaimana DB akan).
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findById(tenantId('tA'), 'foreign-id');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
    // bukti isolasi: where SELALU memuat tenantId kaller
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: 'tA', id: 'foreign-id' });
  });

  it('tenantId is ALWAYS present across findById/findMany/create (never unscoped)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue(row());
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findFirst, findMany, create }));

    await repo.findById(tenantId('tA'), 'c1');
    await repo.findMany(tenantId('tA'));
    await repo.create(tenantId('tA'), { channel: 'WA' });

    expect(findFirst.mock.calls[0]![0].where.tenantId).toBe('tA');
    expect(findMany.mock.calls[0]![0].where.tenantId).toBe('tA');
    expect(create.mock.calls[0]![0].data.tenantId).toBe('tA');
  });

  it('findMany forwards optional state filter alongside tenantId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findMany }));

    await repo.findMany(tenantId('tA'), { state: 'BUILDING' });

    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: 'tA', state: 'BUILDING' } });
  });

  it('maps Prisma Date → ISO string and preserves enums', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue(row({ escalatedAt: new Date('2026-07-04T10:00:00.000Z'), state: 'REVIEW' }));
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findById(tenantId('tA'), 'c1');
    if (r.ok && r.value) {
      expect(r.value.escalatedAt).toBe('2026-07-04T10:00:00.000Z');
      expect(r.value.createdAt).toBe('2026-07-04T00:00:00.000Z');
      expect(r.value.state).toBe('REVIEW');
      expect(r.value.channel).toBe('WA');
    }
  });

  it('returns RepositoryError on delegate failure (error path)', async () => {
    const findFirst = vi.fn().mockRejectedValue(new Error('connection lost'));
    const repo = new ConversationRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findById(tenantId('tA'), 'c1');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNKNOWN');
      expect(r.error.message).toContain('connection lost');
    }
  });
});
