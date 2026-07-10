import { describe, expect, it, vi } from 'vitest';
import { ok, err, tenantId } from '@digimaestro/shared';
import type { LlmJsonPort, RevisionRepository, WebsiteRepository } from '@digimaestro/shared';

import { SitebuilderToolAdapter, type SitebuilderAdapterDeps } from './sitebuilder-tool-adapter.js';

function makeDeps(impl: {
  revisionsFindLatest?: ReturnType<typeof vi.fn>;
  revisionsCreate?: ReturnType<typeof vi.fn>;
  websitesFind?: ReturnType<typeof vi.fn>;
  llmComplete?: ReturnType<typeof vi.fn>;
}): SitebuilderAdapterDeps {
  return {
    revisions: {
      findLatest: impl.revisionsFindLatest ?? vi.fn(),
      create: impl.revisionsCreate ?? vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      name: 'RevisionRepository',
    } as unknown as RevisionRepository,
    websites: {
      findByTenantId: impl.websitesFind ?? vi.fn(),
      update: vi.fn(),
      name: 'WebsiteRepository',
    } as unknown as WebsiteRepository,
    llm: { completeJson: impl.llmComplete ?? vi.fn() } as unknown as LlmJsonPort,
  };
}

const SAMPLE_SITE_DOC = {
  name: 'Warung Bu Rina',
  pages: [
    {
      slug: 'beranda',
      title: 'Beranda',
      sections: [
        { type: 'hero', variant: 'default', props: {} },
        { type: 'contact', variant: 'map', props: {} },
      ],
    },
  ],
};

describe('SitebuilderToolAdapter.getSiteOutline', () => {
  it('returns outline from latest revision (happy)', async () => {
    const revisionsFindLatest = vi.fn().mockResolvedValue(
      ok({ id: 'r1', websiteId: 'w1', number: 1, siteDoc: SAMPLE_SITE_DOC, summary: '', status: 'PREVIEW', createdBy: '', createdAt: '', updatedAt: '' }),
    );
    const websitesFind = vi.fn().mockResolvedValue(
      ok({ id: 'w1', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' }),
    );
    const adapter = new SitebuilderToolAdapter(makeDeps({ revisionsFindLatest, websitesFind }));

    const r = await adapter.getSiteOutline(tenantId('tA'), {});

    expect(r.ok).toBe(true);
    if (r.ok && r.value) {
      expect(r.value.websiteId).toBe('w1');
      expect(r.value.title).toBe('Warung Bu Rina');
      expect(r.value.pages).toHaveLength(1);
      expect(r.value.pages[0].sections).toEqual(['hero', 'contact']);
    }
  });

  it('returns null when no revision exists', async () => {
    const revisionsFindLatest = vi.fn().mockResolvedValue(ok(null));
    const websitesFind = vi.fn().mockResolvedValue(
      ok({ id: 'w1', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' }),
    );
    const adapter = new SitebuilderToolAdapter(makeDeps({ revisionsFindLatest, websitesFind }));

    const r = await adapter.getSiteOutline(tenantId('tA'), {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('returns null when website not found for tenant', async () => {
    const websitesFind = vi.fn().mockResolvedValue(ok(null));
    const adapter = new SitebuilderToolAdapter(makeDeps({ websitesFind }));

    const r = await adapter.getSiteOutline(tenantId('tB'), {});

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });
});

describe('SitebuilderToolAdapter.applyPatch', () => {
  it('loads latest revision, LLM patches, persists new revision (happy)', async () => {
    const revisionsFindLatest = vi.fn().mockResolvedValue(
      ok({ id: 'r1', websiteId: 'w1', number: 1, siteDoc: SAMPLE_SITE_DOC, summary: '', status: 'PREVIEW', createdBy: '', createdAt: '', updatedAt: '' }),
    );
    const llmComplete = vi.fn().mockResolvedValue(ok({ ...SAMPLE_SITE_DOC, name: 'Updated' }));
    const revisionsCreate = vi.fn().mockResolvedValue(ok({
      id: 'r2', websiteId: 'w1', number: 2, siteDoc: {}, summary: '', status: 'DRAFT', createdBy: 'agent', createdAt: '', updatedAt: '',
    }));
    const adapter = new SitebuilderToolAdapter(
      makeDeps({ revisionsFindLatest, revisionsCreate, llmComplete }),
    );

    const r = await adapter.applyPatch(tenantId('tA'), { websiteId: 'w1', instruction: 'Ubah judul jadi Updated' });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.revisionId).toBe('r2');
      expect(r.value.summary).toContain('Revisi #2');
    }
    // LLM called with task 'revision_patch'
    expect(llmComplete).toHaveBeenCalledWith(expect.objectContaining({ task: 'revision_patch' }));
    // New revision persisted
    expect(revisionsCreate).toHaveBeenCalledWith(
      tenantId('tA'),
      expect.objectContaining({ websiteId: 'w1', status: 'DRAFT' }),
    );
  });

  it('NOT_FOUND when no revision exists to patch', async () => {
    const revisionsFindLatest = vi.fn().mockResolvedValue(ok(null));
    const adapter = new SitebuilderToolAdapter(makeDeps({ revisionsFindLatest }));

    const r = await adapter.applyPatch(tenantId('tA'), { websiteId: 'w1', instruction: 'test' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('error when LLM fails', async () => {
    const revisionsFindLatest = vi.fn().mockResolvedValue(
      ok({ id: 'r1', websiteId: 'w1', number: 1, siteDoc: SAMPLE_SITE_DOC, summary: '', status: 'PREVIEW', createdBy: '', createdAt: '', updatedAt: '' }),
    );
    const llmComplete = vi.fn().mockResolvedValue(err({ code: 'HTTP', message: 'timeout', retryable: true, attempt: 3 }));
    const adapter = new SitebuilderToolAdapter(
      makeDeps({ revisionsFindLatest, llmComplete }),
    );

    const r = await adapter.applyPatch(tenantId('tA'), { websiteId: 'w1', instruction: 'test' });

    expect(r.ok).toBe(false);
  });
});
