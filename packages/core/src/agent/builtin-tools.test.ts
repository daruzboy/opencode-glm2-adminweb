import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';

import {
  createOpsGetJobStatusTool,
  createSitebuilderApplyPatchTool,
  createSitebuilderGetSiteOutlineTool,
  type OpsToolPort,
  type SitebuilderToolPort,
} from './builtin-tools.js';

const context = {
  tenantId: tenantId('tA'),
  actor: 'agent',
  scopes: ['sitebuilder', 'ops'] as const,
};

function sitePort(overrides: Partial<SitebuilderToolPort> = {}): SitebuilderToolPort {
  return {
    getSiteOutline: vi.fn().mockResolvedValue(ok({
      websiteId: 'w1',
      title: 'Warung Bakso',
      pages: [{ slug: '/', title: 'Beranda', sections: ['Hero'] }],
    })),
    applyPatch: vi.fn().mockResolvedValue(ok({
      revisionId: 'rev-2',
      summary: 'Kontak dipindahkan.',
    })),
    ...overrides,
  };
}

function opsPort(overrides: Partial<OpsToolPort> = {}): OpsToolPort {
  return {
    getJobStatus: vi.fn().mockResolvedValue(ok({
      jobId: 'job-1',
      status: 'RUNNING',
      kind: 'BUILD',
      attempts: 1,
    })),
    ...overrides,
  };
}

describe('builtin agent tools', () => {
  it('creates sitebuilder_get_site_outline and injects tenant id', async () => {
    const port = sitePort();
    const tool = createSitebuilderGetSiteOutlineTool(port);

    const result = await tool.execute({ websiteId: 'w1' }, context);

    expect(result.ok).toBe(true);
    expect(port.getSiteOutline).toHaveBeenCalledWith('tA', { websiteId: 'w1' });
    if (result.ok) expect(result.value.title).toBe('Warung Bakso');
  });

  it('returns NOT_FOUND when site outline is missing', async () => {
    const tool = createSitebuilderGetSiteOutlineTool(sitePort({
      getSiteOutline: vi.fn().mockResolvedValue(ok(null)),
    }));

    const result = await tool.execute({}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('creates sitebuilder_apply_patch and trims instruction', async () => {
    const port = sitePort();
    const tool = createSitebuilderApplyPatchTool(port);

    const result = await tool.execute({ websiteId: 'w1', instruction: '  pindahkan kontak  ' }, context);

    expect(result).toEqual(ok({ revisionId: 'rev-2', summary: 'Kontak dipindahkan.' }));
    expect(port.applyPatch).toHaveBeenCalledWith('tA', {
      websiteId: 'w1',
      instruction: 'pindahkan kontak',
    });
  });

  it('rejects invalid patch input', async () => {
    const tool = createSitebuilderApplyPatchTool(sitePort());

    const result = await tool.execute({ websiteId: '', instruction: '' }, context);

    expect(result).toEqual(err({ code: 'INVALID_INPUT', message: 'websiteId wajib string' }));
  });

  it('creates ops_get_job_status and maps missing job to NOT_FOUND', async () => {
    const found = createOpsGetJobStatusTool(opsPort());
    const missing = createOpsGetJobStatusTool(opsPort({
      getJobStatus: vi.fn().mockResolvedValue(ok(null)),
    }));

    const foundResult = await found.execute({ jobId: 'job-1' }, context);
    const missingResult = await missing.execute({ jobId: 'missing' }, context);

    expect(foundResult.ok).toBe(true);
    if (foundResult.ok) expect(foundResult.value.status).toBe('RUNNING');
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.error.code).toBe('NOT_FOUND');
  });
});
