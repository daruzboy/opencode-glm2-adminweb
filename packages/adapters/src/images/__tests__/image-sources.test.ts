// P6: adapter sumber gambar stok. Fetch di-inject → teruji offline dengan respons
// rekaman (bentuk nyata API per 2026-07).

import { describe, expect, it, vi } from 'vitest';
import { ChainedImageSource } from '../chained-image-source.js';
import { createHttpImageDownload } from '../http-image-download.js';
import { PexelsImageSource } from '../pexels-image-source.js';
import { UnsplashImageSource } from '../unsplash-image-source.js';
import type { ImageSourcePort, StockImage } from '@digimaestro/shared';

const UNSPLASH_BODY = {
  total: 1,
  results: [
    {
      id: 'abc123',
      width: 4896,
      height: 3264,
      urls: { raw: 'https://images.unsplash.com/photo-1?ixid=xyz', regular: 'https://images.unsplash.com/photo-1?w=1080' },
      links: { html: 'https://unsplash.com/photos/abc123', download_location: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz' },
      user: { name: 'Jane Doe', links: { html: 'https://unsplash.com/@jane' } },
    },
  ],
};

const PEXELS_BODY = {
  total_results: 1,
  photos: [
    {
      id: 5252118,
      width: 6000,
      height: 4000,
      url: 'https://www.pexels.com/photo/5252118/',
      photographer: 'Shandy Galicia',
      photographer_url: 'https://www.pexels.com/@shandy',
      src: { large2x: 'https://images.pexels.com/photos/5252118/large2x.jpg', large: 'https://images.pexels.com/photos/5252118/large.jpg' },
    },
  ],
};

describe('UnsplashImageSource', () => {
  it('memetakan hasil search: id, URL file ber-ukuran, atribusi ber-UTM, download_location', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(UNSPLASH_BODY), { status: 200 }));
    const src = new UnsplashImageSource({ accessKey: 'k', fetch: f as never });

    const res = await src.search({ query: 'motorcycle repair workshop' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    const img = res.value[0] as StockImage;
    expect(img.provider).toBe('unsplash');
    expect(img.providerId).toBe('abc123');
    expect(img.imageUrl).toContain('w=1600');
    expect(img.pageUrl).toContain('utm_source=digimaestro');
    expect(img.authorName).toBe('Jane Doe');
    expect(img.authorUrl).toContain('utm_medium=referral');
    expect(img.downloadLocation).toContain('/download');

    // Header auth Unsplash: Client-ID (bukan Bearer).
    const [url, init] = f.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('query=motorcycle%20repair%20workshop');
    expect(url).toContain('orientation=landscape');
    expect(init.headers.Authorization).toBe('Client-ID k');
  });

  it('401 → AUTH; 429 → RATE_LIMIT; jaringan putus → NETWORK', async () => {
    const auth = new UnsplashImageSource({
      accessKey: 'k',
      fetch: (async () => new Response('{}', { status: 401 })) as never,
    });
    const r1 = await auth.search({ query: 'x' });
    expect(!r1.ok && r1.error.code).toBe('AUTH');

    const limited = new UnsplashImageSource({
      accessKey: 'k',
      fetch: (async () => new Response('{}', { status: 429 })) as never,
    });
    const r2 = await limited.search({ query: 'x' });
    expect(!r2.ok && r2.error.code).toBe('RATE_LIMIT');

    const down = new UnsplashImageSource({
      accessKey: 'k',
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as never,
    });
    const r3 = await down.search({ query: 'x' });
    expect(!r3.ok && r3.error.code).toBe('NETWORK');
  });

  it('trackUsage men-GET download_location dengan Client-ID; error ditelan', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    const src = new UnsplashImageSource({ accessKey: 'k', fetch: f as never });
    await src.trackUsage({
      provider: 'unsplash',
      providerId: 'abc123',
      imageUrl: 'x',
      pageUrl: 'x',
      authorName: 'x',
      authorUrl: 'x',
      width: 1,
      height: 1,
      downloadLocation: 'https://api.unsplash.com/photos/abc123/download',
    });
    expect(f).toHaveBeenCalledOnce();

    const boom = new UnsplashImageSource({
      accessKey: 'k',
      fetch: (async () => {
        throw new Error('boom');
      }) as never,
    });
    await expect(
      boom.trackUsage({
        provider: 'unsplash',
        providerId: 'a',
        imageUrl: 'x',
        pageUrl: 'x',
        authorName: 'x',
        authorUrl: 'x',
        width: 1,
        height: 1,
        downloadLocation: 'https://api.unsplash.com/x',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('PexelsImageSource', () => {
  it('memetakan hasil search: id numerik → string, large2x, atribusi fotografer', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(PEXELS_BODY), { status: 200 }));
    const src = new PexelsImageSource({ apiKey: 'pk', fetch: f as never });

    const res = await src.search({ query: 'coffee shop' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const img = res.value[0] as StockImage;
    expect(img.provider).toBe('pexels');
    expect(img.providerId).toBe('5252118');
    expect(img.imageUrl).toContain('large2x');
    expect(img.authorName).toBe('Shandy Galicia');

    const [, init] = f.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('pk');
  });

  it('403 → AUTH', async () => {
    const src = new PexelsImageSource({
      apiKey: 'pk',
      fetch: (async () => new Response('{}', { status: 403 })) as never,
    });
    const res = await src.search({ query: 'x' });
    expect(!res.ok && res.error.code).toBe('AUTH');
  });
});

describe('ChainedImageSource', () => {
  function fake(provider: string, images: StockImage[], fail = false): ImageSourcePort {
    return {
      name: 'ImageSource',
      provider,
      search: async () =>
        fail
          ? { ok: false as const, error: { code: 'NETWORK' as const, message: 'down' } }
          : { ok: true as const, value: images },
      trackUsage: vi.fn(async () => undefined),
    };
  }
  const img = (provider: string): StockImage => ({
    provider,
    providerId: '1',
    imageUrl: 'u',
    pageUrl: 'p',
    authorName: 'a',
    authorUrl: 'au',
    width: 1,
    height: 1,
  });

  it('penyedia pertama gagal/kosong → jatuh ke berikutnya', async () => {
    const chain = new ChainedImageSource([fake('unsplash', [], true), fake('pexels', [img('pexels')])]);
    const res = await chain.search({ query: 'x' });
    expect(res.ok && res.value[0]?.provider).toBe('pexels');
  });

  it('semua kosong tanpa error → ok []; semua gagal → error terakhir', async () => {
    const empty = new ChainedImageSource([fake('unsplash', []), fake('pexels', [])]);
    const r1 = await empty.search({ query: 'x' });
    expect(r1.ok && r1.value).toEqual([]);

    const allFail = new ChainedImageSource([fake('unsplash', [], true), fake('pexels', [], true)]);
    const r2 = await allFail.search({ query: 'x' });
    expect(r2.ok).toBe(false);
  });

  it('trackUsage dirutekan ke penyedia asal foto', async () => {
    const unsplash = fake('unsplash', []);
    const pexels = fake('pexels', []);
    const chain = new ChainedImageSource([unsplash, pexels]);
    await chain.trackUsage(img('pexels'));
    expect(pexels.trackUsage).toHaveBeenCalledOnce();
    expect(unsplash.trackUsage).not.toHaveBeenCalled();
  });
});

describe('createHttpImageDownload', () => {
  it('sukses → bytes + contentType', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const download = createHttpImageDownload({
      fetch: (async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })) as never,
    });
    const res = await download('https://images.example/a.jpg');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.contentType).toBe('image/jpeg');
      expect(res.value.bytes).toEqual(bytes);
    }
  });

  it('bukan image/* → UNSUPPORTED; melebihi batas → TOO_LARGE; HTTP 404 → DOWNLOAD', async () => {
    const html = createHttpImageDownload({
      fetch: (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as never,
    });
    const r1 = await html('u');
    expect(!r1.ok && r1.error.code).toBe('UNSUPPORTED');

    const big = createHttpImageDownload({
      maxBytes: 2,
      fetch: (async () =>
        new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })) as never,
    });
    const r2 = await big('u');
    expect(!r2.ok && r2.error.code).toBe('TOO_LARGE');

    const missing = createHttpImageDownload({
      fetch: (async () => new Response('', { status: 404 })) as never,
    });
    const r3 = await missing('u');
    expect(!r3.ok && r3.error.code).toBe('DOWNLOAD');
  });
});
