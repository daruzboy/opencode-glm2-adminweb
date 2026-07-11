import { describe, expect, it, vi } from 'vitest';
import { ok, err, tenantId } from '@digimaestro/shared';
import type { LlmJsonPort, LlmJsonSchema, RevisionRepository, WebsiteRepository } from '@digimaestro/shared';
import { buildSiteFromBrief, type BuildDeps, type InterviewBrief } from './build-site.js';

function makeBrief(over: Partial<InterviewBrief> = {}): InterviewBrief {
  return {
    businessName: 'Warung Bu Rina',
    businessType: 'Kuliner',
    targetCustomer: 'Pekerja kantor',
    desiredPages: ['Beranda', 'Menu', 'Kontak'],
    colorPreference: 'oranye hangat',
    contactInfo: { phone: '0812-3456-7890', address: 'Jl. Merdeka 10' },
    ...over,
  };
}

const PERMISSIVE_SCHEMA: LlmJsonSchema<unknown> = {
  safeParse: (v: unknown) => ({ success: true as const, data: v }),
};

function makeDeps(impl: {
  llmResult?: ReturnType<typeof vi.fn>;
  revisionCreate?: ReturnType<typeof vi.fn>;
  websiteFind?: ReturnType<typeof vi.fn>;
}): BuildDeps {
  return {
    llm: { completeJson: impl.llmResult ?? vi.fn() } as unknown as LlmJsonPort,
    revisions: {
      create: impl.revisionCreate ?? vi.fn(),
      findById: vi.fn(),
      findLatest: vi.fn(),
      update: vi.fn(),
      name: 'RevisionRepository',
    } as unknown as RevisionRepository,
    websites: {
      findByTenantId: impl.websiteFind ?? vi.fn(),
      update: vi.fn(),
      name: 'WebsiteRepository',
    } as unknown as WebsiteRepository,
    siteDocSchema: PERMISSIVE_SCHEMA,
    assembleDoc: (draft: unknown, websiteId: string) => ({ ...(draft as object), websiteId }),
  };
}

describe('buildSiteFromBrief — happy path', () => {
  it('generates site document via LLM and persists revision', async () => {
    const websiteFind = vi.fn().mockResolvedValue(
      ok({ id: 'w1', tenantId: 'tA', slug: 'warung-bu-rina', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' }),
    );
    const llmResult = vi.fn().mockResolvedValue(ok({ name: 'Warung Bu Rina', pages: [] }));
    const revisionCreate = vi.fn().mockResolvedValue(ok({
      id: 'rev1', websiteId: 'w1', number: 1, siteDoc: {}, summary: '', status: 'DRAFT', createdBy: 'agent', createdAt: '', updatedAt: '',
    }));

    const deps = makeDeps({ websiteFind, llmResult, revisionCreate });
    const r = await buildSiteFromBrief(deps, { tenantId: tenantId('tA'), websiteId: 'w1', brief: makeBrief() });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.revisionId).toBe('rev1');
      expect(r.value.revisionNumber).toBe(1);
    }
    expect(llmResult).toHaveBeenCalledWith(expect.objectContaining({ task: 'site_plan' }));
    expect(revisionCreate).toHaveBeenCalledWith(
      tenantId('tA'),
      expect.objectContaining({ websiteId: 'w1', status: 'DRAFT', createdBy: 'agent' }),
    );
  });

  it('passes brief content in user message', async () => {
    const llmResult = vi.fn().mockResolvedValue(ok({}));
    const deps = makeDeps({
      llmResult,
      websiteFind: vi.fn().mockResolvedValue(ok({ id: 'w1', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' })),
      revisionCreate: vi.fn().mockResolvedValue(ok({ id: 'r1', websiteId: 'w1', number: 1, siteDoc: {}, summary: '', status: 'DRAFT', createdBy: '', createdAt: '', updatedAt: '' })),
    });

    await buildSiteFromBrief(deps, { tenantId: tenantId('tA'), websiteId: 'w1', brief: makeBrief({ businessName: 'Toko Maju' }) });

    const userMsg = llmResult.mock.calls[0]![0].messages[0].content as string;
    expect(userMsg).toContain('Toko Maju');
  });
});

describe('buildSiteFromBrief — error paths', () => {
  it('NOT_FOUND when website does not belong to tenant', async () => {
    const websiteFind = vi.fn().mockResolvedValue(ok(null));
    const deps = makeDeps({ websiteFind });

    const r = await buildSiteFromBrief(deps, { tenantId: tenantId('tB'), websiteId: 'w1', brief: makeBrief() });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('NOT_FOUND when website ID does not match tenant website', async () => {
    const websiteFind = vi.fn().mockResolvedValue(ok({ id: 'w-other', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' }));
    const deps = makeDeps({ websiteFind });

    const r = await buildSiteFromBrief(deps, { tenantId: tenantId('tA'), websiteId: 'w1', brief: makeBrief() });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('LLM_FAILED when LLM returns error', async () => {
    const llmResult = vi.fn().mockResolvedValue(err({ code: 'HTTP', message: '503', retryable: true, attempt: 3 }));
    const deps = makeDeps({
      llmResult,
      websiteFind: vi.fn().mockResolvedValue(ok({ id: 'w1', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' })),
    });

    const r = await buildSiteFromBrief(deps, { tenantId: tenantId('tA'), websiteId: 'w1', brief: makeBrief() });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LLM_FAILED');
  });

  it('propagates revision create failure', async () => {
    const revisionCreate = vi.fn().mockResolvedValue(err({ code: 'UNKNOWN', message: 'DB down' }));
    const deps = makeDeps({
      revisionCreate,
      websiteFind: vi.fn().mockResolvedValue(ok({ id: 'w1', tenantId: 'tA', slug: 's', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' })),
      llmResult: vi.fn().mockResolvedValue(ok({})),
    });

    const r = await buildSiteFromBrief(deps, { tenantId: tenantId('tA'), websiteId: 'w1', brief: makeBrief() });

    expect(r.ok).toBe(false);
  });
});
