import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeployableFile } from '@digimaestro/shared';
import { LocalArtifactStore } from '../local-artifact-store.js';
import { LocalFilesystemDeploy } from '../local-deploy.js';

const files: DeployableFile[] = [
  { path: 'index.html', contents: '<!doctype html><h1>Hai</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'kontak/index.html', contents: '<!doctype html><h1>Kontak</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n', contentType: 'text/plain; charset=utf-8' },
];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dm-publish-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalArtifactStore', () => {
  it('store menulis file + manifest, retrieve mengembalikan utuh (rollback)', async () => {
    const store = new LocalArtifactStore(join(dir, 'artifacts'));
    const stored = await store.store({ key: 'w1/rev-1', files });
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.value.fileCount).toBe(3);

    const got = await store.retrieve('w1/rev-1');
    expect(got.ok).toBe(true);
    if (got.ok && got.value) {
      expect(got.value.map((f) => f.path).sort()).toEqual(['index.html', 'kontak/index.html', 'robots.txt']);
      expect(got.value.find((f) => f.path === 'index.html')?.contents).toContain('Hai');
    }
  });

  it('retrieve key tak ada → null', async () => {
    const store = new LocalArtifactStore(join(dir, 'artifacts'));
    const got = await store.retrieve('tidak/ada');
    expect(got).toMatchObject({ ok: true, value: null });
  });
});

describe('LocalFilesystemDeploy', () => {
  it('menulis file ke docroot per slug + mengembalikan URL', async () => {
    const deploy = new LocalFilesystemDeploy({ docrootBase: join(dir, 'www'), baseDomain: 'digimaestro.id' });
    const res = await deploy.deploy({ target: { slug: 'warung-demo' }, files });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.url).toBe('https://warung-demo.digimaestro.id');
      expect(res.value.fileCount).toBe(3);
    }
    const html = await readFile(join(dir, 'www', 'warung-demo', 'index.html'), 'utf8');
    expect(html).toContain('Hai');
  });

  it('deploy bersih: file lama yang tak ada di rilis baru dihapus', async () => {
    const deploy = new LocalFilesystemDeploy({ docrootBase: join(dir, 'www'), baseDomain: 'digimaestro.id' });
    await deploy.deploy({ target: { slug: 's' }, files });
    await deploy.deploy({ target: { slug: 's' }, files: [{ path: 'index.html', contents: 'baru', contentType: 'text/html' }] });
    const entries = await readdir(join(dir, 'www', 's'));
    expect(entries).toEqual(['index.html']); // robots.txt & kontak/ dari rilis lama hilang
  });
});
