import { describe, it, expect } from 'vitest';
import {
  ok,
  type ArtifactStorePort,
  type DeployPort,
  type PublishError,
  type Result,
  type ArtifactRef,
  type DeployResult,
  type DeployableFile,
} from '@digimaestro/shared';
import { THEMES } from '@digimaestro/sites-kit';
import type { PublishDeps } from './publish.js';
import { processPublishJob, type PublishQueueJob } from './publish-job.js';

function validDoc(): unknown {
  return {
    websiteId: 'w1',
    title: 'Warung Demo',
    themeId: 'umkm-fresh',
    tokens: THEMES[0].tokens,
    pages: [{ slug: 'index', title: 'Beranda', sections: [{ type: 'hero', variant: 'centered', props: { headline: 'Hai' } }] }],
  };
}

function fakeStore(retrieve: readonly DeployableFile[] | null = null): ArtifactStorePort {
  return {
    async store({ key, files }): Promise<Result<ArtifactRef, PublishError>> {
      return ok({ key, location: `/artifacts/${key}`, fileCount: files.length });
    },
    async retrieve(): Promise<Result<readonly DeployableFile[] | null, PublishError>> {
      return ok(retrieve);
    },
  };
}

function fakeDeploy(): DeployPort {
  return {
    async deploy({ target, files }): Promise<Result<DeployResult, PublishError>> {
      return ok({ url: `https://${target.slug}.digimaestro.id`, fileCount: files.length });
    },
  };
}

describe('processPublishJob (dispatch antrean publish)', () => {
  it("kind 'publish' → menjalankan publishSite (build+store+deploy)", async () => {
    const deps: PublishDeps = { artifacts: fakeStore(), deploy: fakeDeploy() };
    const job: PublishQueueJob = {
      kind: 'publish',
      websiteId: 'w1',
      revisionNumber: 3,
      slug: 'warung-demo',
      baseUrl: 'https://warung-demo.digimaestro.id',
      siteDocument: validDoc(),
    };
    const res = await processPublishJob(deps, job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.url).toBe('https://warung-demo.digimaestro.id');
      expect(res.value.artifact.key).toBe('w1/rev-3');
    }
  });

  it("kind 'rollback' → redeploy artifact tersimpan tanpa build (butuh retrieve)", async () => {
    const files: DeployableFile[] = [{ path: 'index.html', contents: '<h1>lama</h1>', contentType: 'text/html' }];
    const deps: PublishDeps = { artifacts: fakeStore(files), deploy: fakeDeploy() };
    const job: PublishQueueJob = { kind: 'rollback', websiteId: 'w1', revisionNumber: 2, slug: 'warung-demo' };
    const res = await processPublishJob(deps, job);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.artifact.key).toBe('w1/rev-2');
      expect(res.value.fileCount).toBe(1);
    }
  });

  it("kind 'rollback' tanpa artifact tersimpan → NOT_FOUND", async () => {
    const deps: PublishDeps = { artifacts: fakeStore(null), deploy: fakeDeploy() };
    const res = await processPublishJob(deps, { kind: 'rollback', websiteId: 'w1', revisionNumber: 9, slug: 's' });
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
