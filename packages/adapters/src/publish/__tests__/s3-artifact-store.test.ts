import { describe, it, expect } from 'vitest';
import type { DeployableFile } from '@digimaestro/shared';
import { S3ArtifactStore, type S3ObjectClient } from '../s3-artifact-store.js';

const files: DeployableFile[] = [
  { path: 'index.html', contents: '<!doctype html><h1>Hai</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'menu/index.html', contents: '<!doctype html><h1>Menu</h1>', contentType: 'text/html; charset=utf-8' },
  { path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n', contentType: 'text/plain; charset=utf-8' },
];

// Fake object storage in-memory (offline — tanpa @aws-sdk/jaringan).
function fakeS3(bucket = 'digimaestro-artifacts'): S3ObjectClient & { readonly objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    bucket,
    objects,
    async putObject({ key, body }) {
      objects.set(key, body);
    },
    async getObject({ key }) {
      return objects.has(key) ? (objects.get(key) as string) : null;
    },
  };
}

describe('S3ArtifactStore', () => {
  it('store menulis tiap file + manifest sebagai objek terpisah, retrieve mengembalikan utuh', async () => {
    const client = fakeS3();
    const store = new S3ArtifactStore(client);

    const stored = await store.store({ key: 'w1/rev-1', files });
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.value.fileCount).toBe(3);
      expect(stored.value.location).toBe('s3://digimaestro-artifacts/w1/rev-1');
    }
    // Objek disimpan dengan key '/' (separator S3, bukan OS) + manifest.
    expect([...client.objects.keys()].sort()).toEqual([
      'w1/rev-1/_manifest.json',
      'w1/rev-1/index.html',
      'w1/rev-1/menu/index.html',
      'w1/rev-1/robots.txt',
    ]);

    const got = await store.retrieve('w1/rev-1');
    expect(got.ok).toBe(true);
    if (got.ok && got.value) {
      expect(got.value.map((f) => f.path).sort()).toEqual(['index.html', 'menu/index.html', 'robots.txt']);
      expect(got.value.find((f) => f.path === 'index.html')?.contents).toContain('Hai');
      expect(got.value.find((f) => f.path === 'robots.txt')?.contentType).toBe('text/plain; charset=utf-8');
    }
  });

  it('retrieve key tak ada (manifest absen) → null', async () => {
    const store = new S3ArtifactStore(fakeS3());
    const got = await store.retrieve('tidak/ada');
    expect(got).toMatchObject({ ok: true, value: null });
  });

  it('retrieve artifact rusak (objek file hilang meski manifest ada) → err STORE', async () => {
    const client = fakeS3();
    const store = new S3ArtifactStore(client);
    await store.store({ key: 'w1/rev-1', files });
    client.objects.delete('w1/rev-1/menu/index.html'); // simulasi objek hilang

    const got = await store.retrieve('w1/rev-1');
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe('STORE');
  });

  it('store membungkus kegagalan klien jadi err STORE', async () => {
    const client: S3ObjectClient = {
      bucket: 'b',
      async putObject() {
        throw new Error('koneksi ditolak');
      },
      async getObject() {
        return null;
      },
    };
    const store = new S3ArtifactStore(client);
    const res = await store.store({ key: 'k', files });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('STORE');
      expect(res.error.message).toContain('koneksi ditolak');
    }
  });
});
