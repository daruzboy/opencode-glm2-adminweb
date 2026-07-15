import { describe, it, expect } from 'vitest';
import { ok, err, type ArtifactStorePort, type DeployPort, type PublishError, type Result, type ArtifactRef, type DeployResult, type DeployableFile } from '@digimaestro/shared';
import { THEMES } from '@digimaestro/sites-kit';
import { publishSite, rollbackSite, type PublishDeps } from './publish.js';

function validDoc(): unknown {
  return {
    websiteId: 'w1',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [{ slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: { headline: 'Hai' } }] }],
  };
}

function fakeStore(over: { storeErr?: boolean; retrieve?: readonly DeployableFile[] | null } = {}): ArtifactStorePort {
  return {
    async store({ key, files }): Promise<Result<ArtifactRef, PublishError>> {
      if (over.storeErr) return err({ code: 'STORE', message: 'disk full' });
      return ok({ key, location: `/artifacts/${key}`, fileCount: files.length });
    },
    async retrieve(): Promise<Result<readonly DeployableFile[] | null, PublishError>> {
      return ok(over.retrieve ?? null);
    },
  };
}

function fakeDeploy(over: { deployErr?: boolean } = {}): DeployPort {
  return {
    async deploy({ target, files }): Promise<Result<DeployResult, PublishError>> {
      if (over.deployErr) return err({ code: 'DEPLOY', message: 'ssh refused' });
      return ok({ url: `https://${target.slug}.digimaestro.id`, fileCount: files.length });
    },
  };
}

const input = { websiteId: 'w1', revisionNumber: 3, slug: 'warung-demo', baseUrl: 'https://warung-demo.digimaestro.id', siteDocument: validDoc() };

describe('publishSite (FR-PUB-004)', () => {
  it('pipeline sukses: build → store → deploy → url', async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy() };
    const res = await publishSite(deps, input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.url).toBe('https://warung-demo.digimaestro.id');
      expect(res.value.artifact.key).toBe('w1/rev-3');
      expect(res.value.fileCount).toBeGreaterThan(0); // html + sitemap + robots
    }
  });

  it('site document invalid → BUILD', async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy() };
    const res = await publishSite(deps, { ...input, siteDocument: { pages: [] } });
    expect(res).toMatchObject({ ok: false, error: { code: 'BUILD' } });
  });

  it('gagal store → STORE (tak lanjut deploy)', async () => {
    const res = await publishSite({ artifacts: fakeStore({ storeErr: true }), deploy: fakeDeploy() }, input);
    expect(res).toMatchObject({ ok: false, error: { code: 'STORE' } });
  });

  it('gagal deploy → DEPLOY', async () => {
    const res = await publishSite({ artifacts: fakeStore(), deploy: fakeDeploy({ deployErr: true }), }, input);
    expect(res).toMatchObject({ ok: false, error: { code: 'DEPLOY' } });
  });

  it('verifikasi HTTP gagal → VERIFY', async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy(), verify: async () => false };
    expect(await publishSite(deps, input)).toMatchObject({ ok: false, error: { code: 'VERIFY' } });
  });

  it('verifikasi HTTP sukses → ok', async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy(), verify: async () => true };
    expect((await publishSite(deps, input)).ok).toBe(true);
  });
});

describe('rollbackSite (FR-PUB-005)', () => {
  it('redeploy artifact tersimpan tanpa build ulang', async () => {
    const stored: DeployableFile[] = [{ path: 'index.html', contents: '<!doctype html>', contentType: 'text/html' }];
    const deps: PublishDeps = { artifacts: fakeStore({ retrieve: stored }), deploy: fakeDeploy() };
    const res = await rollbackSite(deps, { websiteId: 'w1', revisionNumber: 2, slug: 'warung-demo' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.url).toBe('https://warung-demo.digimaestro.id');
  });

  it('artifact tak ada → NOT_FOUND', async () => {
    const deps: PublishDeps = { artifacts: fakeStore({ retrieve: null }), deploy: fakeDeploy() };
    expect(await rollbackSite(deps, { websiteId: 'w1', revisionNumber: 9, slug: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('publishSite — provisioning subdomain (FR-PUB-004b)', () => {
  function fakeSubdomain(over: { err?: boolean } = {}) {
    const calls: Array<{ slug: string; rootDomain: string; docroot: string }> = [];
    const port = {
      async ensureSubdomain(inp: { slug: string; rootDomain: string; docroot: string }) {
        calls.push(inp);
        if (over.err) return err({ code: 'SUBDOMAIN' as const, message: 'UAPI gagal' });
        return ok({ subdomain: `${inp.slug}.${inp.rootDomain}`, created: true });
      },
    };
    return { port, calls };
  }

  it('subdomain di-inject → ensureSubdomain dipanggil SEBELUM deploy (docroot default public_html/slug)', async () => {
    const sub = fakeSubdomain();
    let deployedAfterSub = false;
    const deploy = {
      async deploy({ target, files }: { target: { slug: string }; files: readonly DeployableFile[] }) {
        deployedAfterSub = sub.calls.length === 1; // subdomain sudah dipanggil sebelum deploy
        return ok({ url: `https://${target.slug}.digimaestro.id`, fileCount: files.length });
      },
    };
    const deps: PublishDeps = { artifacts: fakeStore(), deploy, subdomain: sub.port };
    const res = await publishSite(deps, { ...input, rootDomain: 'digimaestro.id' });
    expect(res.ok).toBe(true);
    expect(sub.calls).toEqual([{ slug: 'warung-demo', rootDomain: 'digimaestro.id', docroot: 'public_html/warung-demo' }]);
    expect(deployedAfterSub).toBe(true);
  });

  it('subdomain di-inject tanpa rootDomain → err SUBDOMAIN (tak deploy)', async () => {
    const sub = fakeSubdomain();
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy(), subdomain: sub.port };
    const res = await publishSite(deps, input); // tanpa rootDomain
    expect(res).toMatchObject({ ok: false, error: { code: 'SUBDOMAIN' } });
    expect(sub.calls).toHaveLength(0);
  });

  it('ensureSubdomain gagal → err SUBDOMAIN (tak deploy)', async () => {
    const sub = fakeSubdomain({ err: true });
    let deployed = false;
    const deploy = {
      async deploy() {
        deployed = true;
        return ok({ url: 'x', fileCount: 0 });
      },
    };
    const deps: PublishDeps = { artifacts: fakeStore(), deploy, subdomain: sub.port };
    const res = await publishSite(deps, { ...input, rootDomain: 'digimaestro.id' });
    expect(res).toMatchObject({ ok: false, error: { code: 'SUBDOMAIN' } });
    expect(deployed).toBe(false);
  });

  it('tanpa subdomain di-inject → dilewati (backward-compatible)', async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy() };
    expect((await publishSite(deps, input)).ok).toBe(true);
  });
});

// Preview PUBLIK (2026-07-15): mode pratinjau — noindex, tanpa artifact, tanpa subdomain.
describe('publishSite — mode preview', () => {
  it('preview: html disuntik noindex, artifact TIDAK disimpan, subdomain dilewati', async () => {
    let stored = 0;
    const store: ArtifactStorePort = {
      async store({ key, files }) {
        stored += 1;
        return ok({ key, location: key, fileCount: files.length });
      },
      async retrieve() {
        return ok(null);
      },
    };
    let deployedFiles: readonly DeployableFile[] = [];
    const deploy: DeployPort = {
      async deploy({ target, files }) {
        deployedFiles = files;
        return ok({ url: `https://digimaestro.id/${target.slug}/`, fileCount: files.length });
      },
    };
    let subdomainCalled = 0;
    const deps: PublishDeps = {
      artifacts: store,
      deploy,
      subdomain: {
        async ensureSubdomain() {
          subdomainCalled += 1;
          return ok({ created: false });
        },
      },
    };

    const res = await publishSite(deps, { ...input, slug: 'preview/warung-demo-tok', preview: true });
    expect(res.ok).toBe(true);
    expect(stored).toBe(0);
    expect(subdomainCalled).toBe(0);
    const html = deployedFiles.find((f) => f.path.endsWith('.html'));
    expect(String(html?.contents)).toContain('<meta name="robots" content="noindex">');
  });

  it('mode live tak berubah: artifact tersimpan, TANPA noindex', async () => {
    let deployedFiles: readonly DeployableFile[] = [];
    const deploy: DeployPort = {
      async deploy({ target, files }) {
        deployedFiles = files;
        return ok({ url: `https://${target.slug}.digimaestro.id`, fileCount: files.length });
      },
    };
    const res = await publishSite({ artifacts: fakeStore(), deploy }, input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.artifact.key).toContain('w1/rev-3');
    const html = deployedFiles.find((f) => f.path.endsWith('.html'));
    expect(String(html?.contents)).not.toContain('noindex');
  });
});
