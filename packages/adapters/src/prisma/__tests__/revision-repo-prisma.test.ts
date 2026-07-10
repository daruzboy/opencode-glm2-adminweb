import { describe, expect, it, vi } from 'vitest';
import type { Revision as PrismaRevision } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';

import { RevisionRepositoryPrisma } from '../revision-repo-prisma.js';
import type { RevisionDelegate } from '../revision-repo-prisma.js';

function revRow(over: Partial<PrismaRevision> = {}): PrismaRevision {
  return {
    id: 'r1',
    websiteId: 'w1',
    number: 1,
    siteDoc: { pages: [] },
    summary: 'Initial build',
    status: 'DRAFT',
    createdBy: 'agent',
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
    ...over,
  } as PrismaRevision;
}

function makeDelegate(impl: {
  websiteFindFirst?: ReturnType<typeof vi.fn>;
  revisionFindFirst?: ReturnType<typeof vi.fn>;
  revisionCount?: ReturnType<typeof vi.fn>;
  revisionCreate?: ReturnType<typeof vi.fn>;
  revisionUpdateMany?: ReturnType<typeof vi.fn>;
}): RevisionDelegate {
  return {
    website: {
      findFirst: impl.websiteFindFirst ?? vi.fn().mockResolvedValue({ id: 'w1' }),
    },
    revision: {
      findFirst: impl.revisionFindFirst ?? vi.fn(),
      count: impl.revisionCount ?? vi.fn().mockResolvedValue(0),
      create: impl.revisionCreate ?? vi.fn(),
      updateMany: impl.revisionUpdateMany ?? vi.fn(),
    },
  } as unknown as RevisionDelegate;
}

describe('RevisionRepositoryPrisma.findById — tenant-scoped via Website', () => {
  it('finds revision after verifying website ownership (happy path)', async () => {
    const websiteFindFirst = vi.fn().mockResolvedValue({ id: 'w1' });
    const revisionFindFirst = vi.fn().mockResolvedValue(revRow());
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ websiteFindFirst, revisionFindFirst }),
    );

    const r = await repo.findById(tenantId('tA'), 'w1', 'r1');

    expect(r.ok).toBe(true);
    expect(websiteFindFirst).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 'tA' } });
    if (r.ok && r.value) {
      expect(r.value.id).toBe('r1');
      expect(r.value.number).toBe(1);
    }
  });

  it('returns null when website belongs to another tenant (cross-tenant, no leak)', async () => {
    const websiteFindFirst = vi.fn().mockResolvedValue(null);
    const revisionFindFirst = vi.fn();
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ websiteFindFirst, revisionFindFirst }),
    );

    const r = await repo.findById(tenantId('tB'), 'w1', 'r1');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
    expect(revisionFindFirst).not.toHaveBeenCalled();
  });

  it('returns null when revision not found', async () => {
    const revisionFindFirst = vi.fn().mockResolvedValue(null);
    const repo = new RevisionRepositoryPrisma(makeDelegate({ revisionFindFirst }));

    const r = await repo.findById(tenantId('tA'), 'w1', 'missing');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('maps Prisma Date → ISO string and preserves siteDoc', async () => {
    const revisionFindFirst = vi.fn().mockResolvedValue(
      revRow({ status: 'PREVIEW', summary: null, updatedAt: new Date('2026-07-10T08:00:00.000Z') }),
    );
    const repo = new RevisionRepositoryPrisma(makeDelegate({ revisionFindFirst }));

    const r = await repo.findById(tenantId('tA'), 'w1', 'r1');

    if (r.ok && r.value) {
      expect(r.value.status).toBe('PREVIEW');
      expect(r.value.summary).toBeNull();
      expect(r.value.updatedAt).toBe('2026-07-10T08:00:00.000Z');
    }
  });
});

describe('RevisionRepositoryPrisma.findLatest', () => {
  it('finds latest revision ordered by number desc (happy)', async () => {
    const revisionFindFirst = vi.fn().mockResolvedValue(revRow({ number: 5, status: 'PREVIEW' }));
    const repo = new RevisionRepositoryPrisma(makeDelegate({ revisionFindFirst }));

    const r = await repo.findLatest(tenantId('tA'), 'w1');

    expect(r.ok).toBe(true);
    expect(revisionFindFirst).toHaveBeenCalledWith({
      where: { websiteId: 'w1' },
      orderBy: { number: 'desc' },
    });
    if (r.ok && r.value) expect(r.value.number).toBe(5);
  });

  it('returns null when no revisions exist', async () => {
    const revisionFindFirst = vi.fn().mockResolvedValue(null);
    const repo = new RevisionRepositoryPrisma(makeDelegate({ revisionFindFirst }));

    const r = await repo.findLatest(tenantId('tA'), 'w1');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns null when website not owned (cross-tenant)', async () => {
    const websiteFindFirst = vi.fn().mockResolvedValue(null);
    const revisionFindFirst = vi.fn();
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ websiteFindFirst, revisionFindFirst }),
    );

    const r = await repo.findLatest(tenantId('tB'), 'w1');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
    expect(revisionFindFirst).not.toHaveBeenCalled();
  });
});

describe('RevisionRepositoryPrisma.create', () => {
  it('auto-increments number via count + 1 (happy)', async () => {
    const revisionCount = vi.fn().mockResolvedValue(2);
    const revisionCreate = vi.fn().mockResolvedValue(revRow({ number: 3 }));
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ revisionCount, revisionCreate }),
    );

    const r = await repo.create(tenantId('tA'), {
      websiteId: 'w1',
      siteDoc: { pages: [{ slug: 'home' }] },
      createdBy: 'agent',
    });

    expect(r.ok).toBe(true);
    expect(revisionCount).toHaveBeenCalledWith({ where: { websiteId: 'w1' } });
    expect(revisionCreate).toHaveBeenCalledWith({
      data: {
        websiteId: 'w1',
        number: 3,
        siteDoc: { pages: [{ slug: 'home' }] },
        summary: null,
        status: 'DRAFT',
        createdBy: 'agent',
      },
    });
    if (r.ok) expect(r.value.number).toBe(3);
  });

  it('first revision gets number 1', async () => {
    const revisionCount = vi.fn().mockResolvedValue(0);
    const revisionCreate = vi.fn().mockResolvedValue(revRow({ number: 1 }));
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ revisionCount, revisionCreate }),
    );

    const r = await repo.create(tenantId('tA'), {
      websiteId: 'w1',
      siteDoc: {},
      createdBy: 'system',
    });

    expect(r.ok).toBe(true);
    expect(revisionCreate.mock.calls[0]![0].data.number).toBe(1);
  });

  it('NOT_FOUND when website not owned (cross-tenant)', async () => {
    const websiteFindFirst = vi.fn().mockResolvedValue(null);
    const revisionCreate = vi.fn();
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ websiteFindFirst, revisionCreate }),
    );

    const r = await repo.create(tenantId('tB'), {
      websiteId: 'w1',
      siteDoc: {},
      createdBy: 'agent',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    expect(revisionCreate).not.toHaveBeenCalled();
  });

  it('passes optional summary and status', async () => {
    const revisionCreate = vi.fn().mockResolvedValue(revRow());
    const repo = new RevisionRepositoryPrisma(makeDelegate({ revisionCreate }));

    await repo.create(tenantId('tA'), {
      websiteId: 'w1',
      siteDoc: {},
      summary: 'Revised colors',
      status: 'PREVIEW',
      createdBy: 'agent',
    });

    expect(revisionCreate.mock.calls[0]![0].data.summary).toBe('Revised colors');
    expect(revisionCreate.mock.calls[0]![0].data.status).toBe('PREVIEW');
  });
});

describe('RevisionRepositoryPrisma.update', () => {
  it('updates status via updateMany + re-read (happy)', async () => {
    const revisionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revisionFindFirst = vi.fn().mockResolvedValue(revRow({ status: 'APPROVED' }));
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ revisionUpdateMany, revisionFindFirst }),
    );

    const r = await repo.update(tenantId('tA'), 'w1', 'r1', { status: 'APPROVED' });

    expect(r.ok).toBe(true);
    expect(revisionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'r1', websiteId: 'w1' },
      data: { status: 'APPROVED' },
    });
    if (r.ok) expect(r.value.status).toBe('APPROVED');
  });

  it('count 0 → NOT_FOUND', async () => {
    const revisionUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ revisionUpdateMany }),
    );

    const r = await repo.update(tenantId('tA'), 'w1', 'missing', { status: 'PUBLISHED' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('empty input → CONFLICT', async () => {
    const revisionUpdateMany = vi.fn();
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ revisionUpdateMany }),
    );

    const r = await repo.update(tenantId('tA'), 'w1', 'r1', {});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
    expect(revisionUpdateMany).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when website not owned (cross-tenant)', async () => {
    const websiteFindFirst = vi.fn().mockResolvedValue(null);
    const revisionUpdateMany = vi.fn();
    const repo = new RevisionRepositoryPrisma(
      makeDelegate({ websiteFindFirst, revisionUpdateMany }),
    );

    const r = await repo.update(tenantId('tB'), 'w1', 'r1', { status: 'PUBLISHED' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    expect(revisionUpdateMany).not.toHaveBeenCalled();
  });
});
