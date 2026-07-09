import { describe, it, expect } from 'vitest';
import { ok, err, type Result, type PreviewPort, type PreviewRevision, type RepositoryError } from '@digimaestro/shared';
import { THEMES } from '@digimaestro/sites-kit';
import { buildServer } from '../../index.js';
import { handlePreview, type PreviewDeps } from '../handle-preview.js';

function validSiteDoc(): unknown {
  return {
    websiteId: 'w1',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [
      { slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: { headline: 'Halo Preview' } }] },
    ],
  };
}

// Fake PreviewPort: token 'good' → revisi valid; token lain → null; revisi 'boom' → error.
function fakePreview(overrides: Partial<Record<string, unknown>> = {}): PreviewPort {
  return {
    async getPreview(input): Promise<Result<PreviewRevision | null, RepositoryError>> {
      if (input.revisionId === 'boom') return err({ code: 'UNKNOWN', message: 'db down' });
      if (input.token !== 'good') return ok(null);
      const siteDocument = 'siteDocument' in overrides ? overrides.siteDocument : validSiteDoc();
      return ok({ revisionId: input.revisionId, websiteId: 'w1', siteDocument });
    },
  };
}

const deps: PreviewDeps = { preview: fakePreview() };

describe('handlePreview (FR-PUB-001)', () => {
  it('token benar → HTML preview ber-noindex', async () => {
    const res = await handlePreview(deps, { revisionId: 'rev1', token: 'good' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.html).toContain('name="robots" content="noindex,nofollow"');
      expect(res.html).toContain('Halo Preview');
    }
  });

  it('token salah → 404', async () => {
    expect(await handlePreview(deps, { revisionId: 'rev1', token: 'nope' })).toMatchObject({ ok: false, status: 404 });
  });

  it('token kosong → 404 tanpa memanggil port', async () => {
    expect(await handlePreview(deps, { revisionId: 'rev1', token: '  ' })).toMatchObject({ ok: false, status: 404 });
  });

  it('error repo → 500', async () => {
    expect(await handlePreview(deps, { revisionId: 'boom', token: 'good' })).toMatchObject({ ok: false, status: 500 });
  });

  it('dokumen situs tersimpan tidak valid → 500', async () => {
    const bad: PreviewDeps = { preview: fakePreview({ siteDocument: { pages: [] } }) };
    expect(await handlePreview(bad, { revisionId: 'rev1', token: 'good' })).toMatchObject({ ok: false, status: 500 });
  });
});

describe('rute /api/preview/:revisionId (SRS §9)', () => {
  it('GET dgn token benar → 200 HTML + header X-Robots-Tag noindex', async () => {
    const app = await buildServer({ preview: deps, deps: { conversations: {} as never, messages: {} as never } });
    const res = await app.inject({ method: 'GET', url: '/api/preview/rev1?t=good' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toContain('Halo Preview');
    await app.close();
  });

  it('GET dgn token salah → 404', async () => {
    const app = await buildServer({ preview: deps, deps: { conversations: {} as never, messages: {} as never } });
    const res = await app.inject({ method: 'GET', url: '/api/preview/rev1?t=wrong' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-robots-tag']).toContain('noindex');
    await app.close();
  });
});
