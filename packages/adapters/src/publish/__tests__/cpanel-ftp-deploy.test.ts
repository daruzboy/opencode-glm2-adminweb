import { describe, it, expect } from 'vitest';
import type { DeployableFile } from '@digimaestro/shared';
import { CpanelFtpDeploy, type FtpDeployClient } from '../cpanel-ftp-deploy.js';

const files: DeployableFile[] = [
  { path: 'index.html', contents: '<!doctype html><h1>Baru</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'menu/index.html', contents: '<!doctype html><h1>Menu</h1>', contentType: 'text/html; charset=utf-8' },
];

// Fake FTP in-memory (tanpa jaringan/basic-ftp). Sama kontrak RemoteDeployClient.
function fakeFtp(preexisting: string[] = []) {
  const store = new Map<string, string>();
  for (const p of preexisting) store.set(p, 'lama');
  const client: FtpDeployClient = {
    async connect() {},
    async end() {},
    async mkdirp() {},
    async writeFile(path, contents) {
      store.set(path, contents);
    },
    async listAllFiles(dir) {
      const prefix = `${dir.replace(/\/$/, '')}/`;
      return [...store.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
    },
    async deleteFile(path) {
      store.delete(path);
    },
  };
  return { client, store };
}

describe('CpanelFtpDeploy (fallback FTP)', () => {
  it('deploy: upload ke docroot template default + URL subdomain', async () => {
    const f = fakeFtp();
    const res = await new CpanelFtpDeploy(f.client, { baseDomain: 'digimaestro.id' }).deploy({ target: { slug: 'toko' }, files });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.url).toBe('https://toko.digimaestro.id');
      expect(res.value.fileCount).toBe(2);
    }
    expect(f.store.get('public_html/toko/index.html')).toContain('Baru');
    expect(f.store.get('public_html/toko/menu/index.html')).toContain('Menu');
  });

  it('deploy bersih: file lama yang tak ada di rilis baru dihapus (incl. nested)', async () => {
    const f = fakeFtp(['public_html/s/index.html', 'public_html/s/lama.html', 'public_html/s/arsip/2020.html']);
    await new CpanelFtpDeploy(f.client, { baseDomain: 'digimaestro.id' }).deploy({
      target: { slug: 's' },
      files: [{ path: 'index.html', contents: 'baru', contentType: 'text/html' }],
    });
    expect(f.store.get('public_html/s/index.html')).toBe('baru');
    expect(f.store.has('public_html/s/lama.html')).toBe(false);
    expect(f.store.has('public_html/s/arsip/2020.html')).toBe(false);
  });
});
