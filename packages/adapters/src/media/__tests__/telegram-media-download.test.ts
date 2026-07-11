import { describe, expect, it, vi } from 'vitest';
import { TelegramMediaDownload } from '../telegram-media-download.js';

function downloader(fetch: never, over: Record<string, unknown> = {}) {
  return new TelegramMediaDownload({ botToken: 'rahasia', fetch, ...over });
}

const okFile = { ok: true, result: { file_path: 'photos/a.jpg', file_size: 1000 } };

describe('TelegramMediaDownload', () => {
  it('getFile → unduh bytes', async () => {
    const fetch = vi.fn(async (_url: string) => ({
      status: 200,
      json: async () => okFile,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as never;

    const res = await downloader(fetch).download('file-1');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.bytes.byteLength).toBe(3);
  });

  // P0: tanpa timeout, unduhan stall menyita job chat-inbound ±5 menit; BullMQ lalu
  // menganggapnya stalled dan memprosesnya ulang di worker lain.
  it('mengirim AbortSignal (timeout) di getFile DAN unduhan isi', async () => {
    const fetch = vi.fn(async (_u: string, _init?: { signal?: AbortSignal }) => ({
      status: 200,
      json: async () => okFile,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })) as never;

    await downloader(fetch).download('file-1');

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [, init] of calls as [string, { signal?: AbortSignal }][]) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  // Percuma menarik 50 MB hanya untuk membuangnya.
  it('file_size melebihi batas → TOO_LARGE tanpa mengunduh isinya', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, result: { file_path: 'a.jpg', file_size: 99_000_000 } }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as never;

    const res = await downloader(fetch).download('big');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('TOO_LARGE');
    // Hanya getFile yang dipanggil — isinya TIDAK diunduh.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('getFile ditolak → err DOWNLOAD', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: false, description: 'file not found' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as never;

    const res = await downloader(fetch).download('x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('DOWNLOAD');
  });
});
