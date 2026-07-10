import { describe, expect, it, vi } from 'vitest';
import { tenantId, type AgentToolContext } from '@digimaestro/shared';
import type { SitebuilderToolPort } from '@digimaestro/core';
import { createSitebuilderToolRegistry } from './composition.js';

const TENANT = tenantId('t1');
const ctx: AgentToolContext = { tenantId: TENANT, actor: 'agent', scopes: ['sitebuilder'] };

function fakePort(over: Partial<SitebuilderToolPort> = {}): SitebuilderToolPort {
  return {
    getSiteOutline: vi.fn(async () => ({
      ok: true as const,
      value: { websiteId: 'w1', title: 'Warung', pages: [] },
    })),
    applyPatch: vi.fn(async () => ({
      ok: true as const,
      value: { revisionId: 'r2', summary: 'Revisi #2' },
    })),
    ...over,
  };
}

describe('createSitebuilderToolRegistry (T-053d — wiring agent→tool sitebuilder)', () => {
  it('mendaftarkan KEDUA tool sitebuilder untuk tenant ber-scope sitebuilder', () => {
    const reg = createSitebuilderToolRegistry(fakePort());
    const names = reg.listTools(ctx).map((t) => t.name).sort();
    expect(names).toEqual(['sitebuilder_apply_patch', 'sitebuilder_get_site_outline']);
  });

  it('tak mengekspos tool di luar scope sitebuilder (guard scope)', () => {
    const reg = createSitebuilderToolRegistry(fakePort());
    expect(reg.listTools({ tenantId: TENANT, actor: 'agent', scopes: ['ops'] })).toHaveLength(0);
  });

  it('get_site_outline meneruskan ke port dgn tenantId pemanggil', async () => {
    const port = fakePort();
    const reg = createSitebuilderToolRegistry(port);
    const res = await reg.callTool('sitebuilder_get_site_outline', {}, ctx);
    expect(res.ok).toBe(true);
    expect(port.getSiteOutline).toHaveBeenCalledWith(TENANT, {});
  });

  it('apply_patch meneruskan instruksi revisi ke port (jalur persist revision)', async () => {
    const port = fakePort();
    const reg = createSitebuilderToolRegistry(port);
    const res = await reg.callTool(
      'sitebuilder_apply_patch',
      { websiteId: 'w1', instruction: 'ganti judul jadi Warung Sari' },
      ctx,
    );
    expect(res).toEqual({ ok: true, value: { revisionId: 'r2', summary: 'Revisi #2' } });
    expect(port.applyPatch).toHaveBeenCalledWith(TENANT, {
      websiteId: 'w1',
      instruction: 'ganti judul jadi Warung Sari',
    });
  });
});
