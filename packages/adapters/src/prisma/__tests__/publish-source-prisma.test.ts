import { describe, it, expect, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import { PublishSourcePrisma, type PublishSourceDelegate } from '../publish-source-prisma.js';

const TENANT = tenantId('t1');
const SITE_DOC = { website: { name: 'Warung' } };

function delegate(over: {
  website?: { id: string; slug: string } | null;
  revision?: { siteDoc: unknown } | null;
} = {}): PublishSourceDelegate & { websiteFind: ReturnType<typeof vi.fn> } {
  const websiteFind = vi.fn(async () => ('website' in over ? over.website : { id: 'w1', slug: 'warung-demo' }));
  return {
    websiteFind,
    website: { findFirst: websiteFind },
    revision: { findFirst: vi.fn(async () => ('revision' in over ? over.revision : { siteDoc: SITE_DOC })) },
  };
}

describe('PublishSourcePrisma (tenant-scoped)', () => {
  it('website milik tenant + revisi ada → PublishSource (where.tenantId disuntik)', async () => {
    const d = delegate();
    const res = await new PublishSourcePrisma(d).getPublishSource(TENANT, { websiteId: 'w1', revisionNumber: 3 });
    expect(res).toEqual({
      ok: true,
      value: { websiteId: 'w1', revisionNumber: 3, slug: 'warung-demo', siteDocument: SITE_DOC },
    });
    // Guard NFR-09: query website SELALU menyertakan tenantId pemanggil.
    expect(d.websiteFind).toHaveBeenCalledWith({ where: { id: 'w1', tenantId: 't1' } });
  });

  it('website tak ada / lintas tenant → null (tak lanjut ke revisi)', async () => {
    const res = await new PublishSourcePrisma(delegate({ website: null })).getPublishSource(TENANT, { websiteId: 'wX', revisionNumber: 1 });
    expect(res).toMatchObject({ ok: true, value: null });
  });

  it('revisi tak ada → null', async () => {
    const res = await new PublishSourcePrisma(delegate({ revision: null })).getPublishSource(TENANT, { websiteId: 'w1', revisionNumber: 9 });
    expect(res).toMatchObject({ ok: true, value: null });
  });

  it('delegate melempar → err UNKNOWN', async () => {
    const d: PublishSourceDelegate = {
      website: { findFirst: vi.fn(async () => { throw new Error('DB down'); }) },
      revision: { findFirst: vi.fn() },
    };
    const res = await new PublishSourcePrisma(d).getPublishSource(TENANT, { websiteId: 'w1', revisionNumber: 3 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNKNOWN');
  });
});
