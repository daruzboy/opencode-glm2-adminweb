import { describe, expect, it, vi } from 'vitest';
import { tenantId, type AgentToolContext } from '@digimaestro/shared';
import type { BuildDeps } from '../builder/build-site.js';
import { createSitebuilderBuildSiteTool, deriveSlug, parseBriefInput } from './build-site-tool.js';

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
      create: vi.fn(async () => ({ ok: true as const, value: { id: 'w-new', tenantId: 't1', slug: 'warung-sari-abc123', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' } })),
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

  it('website tenant belum ada → AUTO-CREATE (onboarding) lalu build (opsi A)', async () => {
    const deps = fakeDeps({ website: null });
    // Fake stateful: findByTenantId null dulu → setelah create, kembalikan website baru
    // (meniru DB nyata; buildSiteFromBrief me-resolve ulang via findByTenantId).
    const createdWebsite = { id: 'w-new', tenantId: 't1', slug: 'warung-sari-abc123', status: 'DRAFTING', publishedRevisionId: null, themeId: null, deploymentTargetId: null, createdAt: '', updatedAt: '' };
    let current: typeof createdWebsite | null = null;
    (deps.websites.findByTenantId as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, value: current }));
    (deps.websites.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      current = createdWebsite;
      return { ok: true, value: createdWebsite };
    });

    const tool = createSitebuilderBuildSiteTool(deps);
    const res = await tool.execute({ businessName: 'Warung Sari', businessType: 'warung makan' }, ctx);
    expect(res.ok).toBe(true);
    expect(deps.websites.create).toHaveBeenCalled();
    // websiteId hasil create diteruskan ke revisi (bukan gagal NOT_FOUND).
    expect(deps.revisions.create).toHaveBeenCalled();
  });

  it('auto-create gagal → err UNKNOWN (tak lanjut build)', async () => {
    const deps = fakeDeps({ website: null });
    (deps.websites.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'slug terpakai' } });
    const tool = createSitebuilderBuildSiteTool(deps);
    const res = await tool.execute({ businessName: 'A', businessType: 'B' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNKNOWN');
  });
});

describe('deriveSlug', () => {
  it('kebab-case dari nama usaha + sufiks acak', () => {
    const slug = deriveSlug('Warung Sari Rasa!');
    expect(slug).toMatch(/^warung-sari-rasa-[a-z0-9]{1,6}$/);
  });

  it('nama non-alfanumerik → fallback "situs-..."', () => {
    expect(deriveSlug('!!!')).toMatch(/^situs-[a-z0-9]{1,6}$/);
  });
});
