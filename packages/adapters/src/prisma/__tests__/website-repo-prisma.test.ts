import { describe, expect, it, vi } from 'vitest';
import type { Website as PrismaWebsite } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';

import { WebsiteRepositoryPrisma } from '../website-repo-prisma.js';
import type { WebsiteDelegate } from '../website-repo-prisma.js';

function row(over: Partial<PrismaWebsite> = {}): PrismaWebsite {
  return {
    id: 'w1',
    tenantId: 'tA',
    slug: 'warung-demo',
    status: 'DRAFTING',
    publishedRevisionId: null,
    themeId: null,
    deploymentTargetId: null,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:00.000Z'),
    ...over,
  } as PrismaWebsite;
}

function makeDelegate(impl: {
  findFirst?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}): WebsiteDelegate {
  return {
    findFirst: impl.findFirst ?? vi.fn(),
    updateMany: impl.updateMany ?? vi.fn(),
    create: impl.create ?? vi.fn(),
  } as unknown as WebsiteDelegate;
}

describe('WebsiteRepositoryPrisma — NFR-09: tenantId always scoped', () => {
  it('findByTenantId injects caller tenantId into where (happy path)', async () => {
    const findFirst = vi.fn().mockResolvedValue(row());
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findByTenantId(tenantId('tA'));

    expect(r.ok).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tA' } });
    if (r.ok && r.value) {
      expect(r.value.id).toBe('w1');
      expect(r.value.slug).toBe('warung-demo');
    }
  });

  it('findByTenantId returns null when website not found (no leak)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findByTenantId(tenantId('tB'));

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: 'tB' });
  });

  it('maps Prisma Date → ISO string and preserves enums', async () => {
    const findFirst = vi.fn().mockResolvedValue(
      row({ status: 'PUBLISHED', publishedRevisionId: 'rev3', updatedAt: new Date('2026-07-10T12:00:00.000Z') }),
    );
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findByTenantId(tenantId('tA'));

    if (r.ok && r.value) {
      expect(r.value.status).toBe('PUBLISHED');
      expect(r.value.publishedRevisionId).toBe('rev3');
      expect(r.value.updatedAt).toBe('2026-07-10T12:00:00.000Z');
    }
  });

  it('returns RepositoryError on delegate failure (error path)', async () => {
    const findFirst = vi.fn().mockRejectedValue(new Error('connection lost'));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ findFirst }));

    const r = await repo.findByTenantId(tenantId('tA'));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNKNOWN');
      expect(r.error.message).toContain('connection lost');
    }
  });
});

describe('WebsiteRepositoryPrisma.update — tenant-scoped', () => {
  it('update injects tenantId into where updateMany + re-read (happy)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue(row({ status: 'PUBLISHED', publishedRevisionId: 'rev1' }));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ updateMany, findFirst }));

    const r = await repo.update(tenantId('tA'), 'w1', { status: 'PUBLISHED', publishedRevisionId: 'rev1' });

    expect(r.ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tA', id: 'w1' },
      data: { status: 'PUBLISHED', publishedRevisionId: 'rev1' },
    });
    if (r.ok) expect(r.value.status).toBe('PUBLISHED');
  });

  it('update with only status works', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue(row({ status: 'APPROVED' }));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ updateMany, findFirst }));

    const r = await repo.update(tenantId('tA'), 'w1', { status: 'APPROVED' });

    expect(r.ok).toBe(true);
    expect(updateMany.mock.calls[0]![0].where).toEqual({ tenantId: 'tA', id: 'w1' });
  });

  it('count 0 (id not found / cross-tenant) → NOT_FOUND, no leak', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ updateMany }));

    const r = await repo.update(tenantId('tA'), 'foreign', { status: 'PUBLISHED' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    expect(updateMany.mock.calls[0]![0].where).toEqual({ tenantId: 'tA', id: 'foreign' });
  });

  it('empty input → CONFLICT, delegate not called', async () => {
    const updateMany = vi.fn();
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ updateMany }));

    const r = await repo.update(tenantId('tA'), 'w1', {});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('WebsiteRepositoryPrisma.create — onboarding (opsi A)', () => {
  it('buat Website DRAFTING + tenantId disuntik (happy)', async () => {
    const create = vi.fn().mockResolvedValue(row({ slug: 'warung-baru' }));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), { slug: 'warung-baru' });

    expect(r.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { tenantId: 'tA', slug: 'warung-baru', status: 'DRAFTING', themeId: null },
    });
    if (r.ok) expect(r.value.slug).toBe('warung-baru');
  });

  it('P2002 (tenant sudah punya website / slug terpakai) → CONFLICT', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), { slug: 'dipakai' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
  });

  it('error DB lain → UNKNOWN', async () => {
    const create = vi.fn().mockRejectedValue(new Error('connection lost'));
    const repo = new WebsiteRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), { slug: 's' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN');
  });
});
