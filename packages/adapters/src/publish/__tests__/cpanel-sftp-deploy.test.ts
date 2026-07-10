import { describe, it, expect } from 'vitest';
import type { DeployableFile } from '@digimaestro/shared';
import { CpanelSftpDeploy, type SftpDeployClient } from '../cpanel-sftp-deploy.js';

const files: DeployableFile[] = [
  { path: 'index.html', contents: '<!doctype html><h1>Baru</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'menu/index.html', contents: '<!doctype html><h1>Menu</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n', contentType: 'text/plain; charset=utf-8' },
];

// Fake SFTP in-memory (tanpa jaringan/ssh2).
function fakeSftp(preexisting: string[] = []) {
  const store = new Map<string, string>();
  for (const p of preexisting) store.set(p, 'lama');
  const mkdirs: string[] = [];
  const removed: string[] = [];
  const calls = { connected: 0, ended: 0 };
  const client: SftpDeployClient = {
    async connect() {
      calls.connected++;
    },
    async end() {
      calls.ended++;
    },
    async mkdirp(dir) {
      mkdirs.push(dir);
    },
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
    async removeDir(dir) {
      removed.push(dir);
      const prefix = `${dir.replace(/\/$/, '')}/`;
      for (const p of [...store.keys()]) if (p.startsWith(prefix)) store.delete(p);
    },
  };
  return { client, store, mkdirs, removed, calls };
}

describe('CpanelSftpDeploy', () => {
  it('deploy: upload semua file ke docroot template default + URL subdomain', async () => {
    const f = fakeSftp();
    const deploy = new CpanelSftpDeploy(f.client, { baseDomain: 'digimaestro.id' });
    const res = await deploy.deploy({ target: { slug: 'warung-demo' }, files });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.url).toBe('https://warung-demo.digimaestro.id');
      expect(res.value.fileCount).toBe(3);
    }
    expect(f.store.get('public_html/warung-demo/index.html')).toContain('Baru');
    expect(f.store.get('public_html/warung-demo/menu/index.html')).toContain('Menu');
    expect(f.calls.connected).toBe(1);
    expect(f.calls.ended).toBe(1); // koneksi ditutup rapi
  });

  it('deploy bersih: file lama yang tak ada di rilis baru dihapus (mirror --delete)', async () => {
    const f = fakeSftp([
      'public_html/s/index.html',
      'public_html/s/lama.html',
      'public_html/s/arsip/2020.html',
    ]);
    const deploy = new CpanelSftpDeploy(f.client, { baseDomain: 'digimaestro.id' });
    await deploy.deploy({
      target: { slug: 's' },
      files: [{ path: 'index.html', contents: 'baru', contentType: 'text/html' }],
    });

    expect(f.store.has('public_html/s/index.html')).toBe(true);
    expect(f.store.get('public_html/s/index.html')).toBe('baru'); // ditimpa
    expect(f.store.has('public_html/s/lama.html')).toBe(false); // dihapus
    expect(f.store.has('public_html/s/arsip/2020.html')).toBe(false); // dihapus (nested)
    expect(f.removed).toContain('public_html/s/arsip'); // direktori usang ikut dihapus (mirror penuh)
  });

  it('menghormati target.docroot eksplisit + docrootTemplate kustom', async () => {
    const f = fakeSftp();
    const deploy = new CpanelSftpDeploy(f.client, { baseDomain: 'digimaestro.id', docrootTemplate: 'www/{slug}/public' });
    await deploy.deploy({ target: { slug: 'x', docroot: 'custom/root' }, files: [files[0]] });
    expect(f.store.has('custom/root/index.html')).toBe(true); // docroot eksplisit menang

    const f2 = fakeSftp();
    const deploy2 = new CpanelSftpDeploy(f2.client, { baseDomain: 'digimaestro.id', docrootTemplate: 'www/{slug}/public' });
    await deploy2.deploy({ target: { slug: 'toko' }, files: [files[0]] });
    expect(f2.store.has('www/toko/public/index.html')).toBe(true); // template kustom
  });

  it('kegagalan klien → err DEPLOY + koneksi ditutup', async () => {
    let ended = 0;
    const client: SftpDeployClient = {
      async connect() {},
      async end() {
        ended++;
      },
      async mkdirp() {},
      async writeFile() {
        throw new Error('permission denied');
      },
      async listAllFiles() {
        return [];
      },
      async deleteFile() {},
      async removeDir() {},
    };
    const deploy = new CpanelSftpDeploy(client, { baseDomain: 'digimaestro.id' });
    const res = await deploy.deploy({ target: { slug: 's' }, files });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('DEPLOY');
      expect(res.error.message).toContain('permission denied');
    }
    expect(ended).toBe(1); // cleanup koneksi pada jalur error
  });
});
