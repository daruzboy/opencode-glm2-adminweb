import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import { FtpsMediaStore, MEDIA_PREFIX, mediaFilename } from '../ftps-media-store.js';
import type { RemoteDeployClient } from '../../publish/remote-deploy.js';

function fakeClient(over: Partial<RemoteDeployClient> = {}) {
  return {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    mkdirp: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    listAllFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => {}),
    removeDir: vi.fn(async () => {}),
    ...over,
  } as unknown as RemoteDeployClient;
}

const BYTES = new Uint8Array([1, 2, 3]);

describe('FtpsMediaStore.store', () => {
  it('menyimpan di media/<tenantId>/ dan mengembalikan URL publik', async () => {
    const client = fakeClient();
    const store = new FtpsMediaStore(() => client, { baseDomain: 'digimaestro.id' });

    const res = await store.store({
      tenantId: tenantId('t1'),
      filename: 'abc.webp',
      bytes: BYTES,
      contentType: 'image/webp',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.key).toBe('media/t1/abc.webp');
      // Galeri merender <img src> → URL harus publik & ber-HTTPS.
      expect(res.value.url).toBe('https://digimaestro.id/media/t1/abc.webp');
    }
    expect(client.mkdirp).toHaveBeenCalledWith('media/t1');
    // Byte diteruskan APA ADANYA (biner) — bukan di-encode jadi string.
    expect(client.writeFile).toHaveBeenCalledWith('media/t1/abc.webp', BYTES);
  });

  // Deploy publish = MIRROR PENUH: apa pun di dalam docroot situs (<slug>/) dihapus saat
  // publish berikutnya. Media WAJIB di luar docroot situs, kalau tidak foto pelanggan lenyap.
  it('media TIDAK berada di dalam docroot situs (aman dari mirror-delete)', async () => {
    const client = fakeClient();
    const store = new FtpsMediaStore(() => client, { baseDomain: 'digimaestro.id' });

    const res = await store.store({
      tenantId: tenantId('t1'),
      filename: 'x.webp',
      bytes: BYTES,
      contentType: 'image/webp',
    });

    expect(res.ok && res.value.key.startsWith(`${MEDIA_PREFIX}/`)).toBe(true);
    // Bukan di bawah slug situs mana pun.
    if (res.ok) expect(res.value.key).not.toContain('sate-pak-dar');
  });

  it('FTP gagal → err STORE dan koneksi tetap ditutup (tak menggantung di server)', async () => {
    const client = fakeClient({
      writeFile: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    const store = new FtpsMediaStore(() => client, { baseDomain: 'digimaestro.id' });

    const res = await store.store({
      tenantId: tenantId('t1'),
      filename: 'x.webp',
      bytes: BYTES,
      contentType: 'image/webp',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('STORE');
    expect(client.end).toHaveBeenCalled();
  });
});

describe('mediaFilename — content-addressed', () => {
  it('isi sama → nama sama (tak menumpuk duplikat, URL stabil)', () => {
    expect(mediaFilename(BYTES, 'image/webp')).toBe(mediaFilename(BYTES, 'image/webp'));
  });

  it('isi beda → nama beda', () => {
    expect(mediaFilename(BYTES, 'image/webp')).not.toBe(
      mediaFilename(new Uint8Array([9, 9]), 'image/webp'),
    );
  });

  it('berekstensi .webp', () => {
    expect(mediaFilename(BYTES, 'image/webp')).toMatch(/^[a-f0-9]{16}\.webp$/);
  });
});
