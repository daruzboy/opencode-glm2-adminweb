import { describe, expect, it, vi } from 'vitest';
import { tenantId, type AgentToolContext } from '@digimaestro/shared';
import type { BuildDeps } from '@digimaestro/core';
import { createSitebuilderBuildSiteTool, parseBriefInput } from './build-site-tool.js';

const TENANT = tenantId('t1');
const ctx: AgentToolContext = { tenantId: TENANT, actor: 'chatbot', scopes: ['sitebuilder'] };

// Fake BuildDeps: website tenant ada, LLM balikan doc, revisi ter-create.
function fakeDeps(over: Partial<Record<'website' | 'revision' | 'llm', unknown>> = {}): BuildDeps {
  return {
    websites: {
      name: 'WebsiteRepository',
      findByTenantId: vi.fn(async () =>
        'website' in over
          ? { ok: true as const, value: over.website as never }
          : { ok: true as const, value: { id: 'w1', tenantId: 't1', slug: 'warung', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' } },
      ),
      update: vi.fn(),
    } as never,
    revisions: {
      name: 'RevisionRepository',
      create: vi.fn(async () => ({ ok: true as const, value: { id: 'r1', websiteId: 'w1', number: 1, siteDoc: {}, summary: null, status: 'DRAFT', createdBy: 'agent', createdAt: '', updatedAt: '' } })),
      findById: vi.fn(),
      findLatest: vi.fn(),
      update: vi.fn(),
    } as never,
    llm: {
      name: 'LlmJsonPort',
      completeJson: vi.fn(async () => ({ ok: true as const, value: { name: 'Warung Sari', pages: [] } })),
    } as never,
    siteDocSchema: { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
  };
}

describe('parseBriefInput', () => {
  it('businessName+businessType wajib → error INVALID_INPUT bila kurang', () => {
    expect(parseBriefInput({}).ok).toBe(false);
    expect(parseBriefInput({ businessName: 'A' }).ok).toBe(false);
    const r = parseBriefInput({ businessName: 'Warung Sari', businessType: 'warung makan' });
    expect(r).toEqual({ ok: true, value: { businessName: 'Warung Sari', businessType: 'warung makan' } });
  });

  it('field opsional diteruskan, non-string di desiredPages disaring', () => {
    const r = parseBriefInput({ businessName: 'A', businessType: 'B', desiredPages: ['home', 1, 'menu'], notes: 'buka tiap hari' });
    expect(r.ok && r.value.desiredPages).toEqual(['home', 'menu']);
    expect(r.ok && r.value.notes).toBe('buka tiap hari');
  });
});

describe('createSitebuilderBuildSiteTool', () => {
  it('metadata tool: nama + scope sitebuilder + field wajib', () => {
    const tool = createSitebuilderBuildSiteTool(fakeDeps());
    expect(tool.name).toBe('sitebuilder_build_site');
    expect(tool.scope).toBe('sitebuilder');
    expect(tool.inputSchema.required).toEqual(['businessName', 'businessType']);
  });

  it('brief valid + website ada → BuildResult (revisi DRAFT dibuat)', async () => {
    const deps = fakeDeps();
    const tool = createSitebuilderBuildSiteTool(deps);
    const res = await tool.execute({ businessName: 'Warung Sari', businessType: 'warung makan' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.revisionNumber).toBe(1);
    expect(deps.revisions.create).toHaveBeenCalled();
  });

  it('input tak valid → INVALID_INPUT (tak sentuh repo)', async () => {
    const deps = fakeDeps();
    const tool = createSitebuilderBuildSiteTool(deps);
    const res = await tool.execute({ businessName: '' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(deps.websites.findByTenantId).not.toHaveBeenCalled();
  });

  it('website tenant belum ada → NOT_FOUND', async () => {
    const deps = fakeDeps({ website: null });
    const tool = createSitebuilderBuildSiteTool(deps);
    const res = await tool.execute({ businessName: 'A', businessType: 'B' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_FOUND');
  });
});
