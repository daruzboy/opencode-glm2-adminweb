// P6: unduh file gambar stok via HTTP → DownloadedMedia (kontrak yang sama dengan unduhan
// foto Telegram) sehingga pipeline lama (Sharp → FTPS → MediaAsset) dipakai apa adanya.

import { MEDIA_MAX_BYTES, err, ok } from '@digimaestro/shared';
import type { DownloadedMedia, MediaError, Result } from '@digimaestro/shared';

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface HttpImageDownloadOptions {
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export type HttpImageDownloadFn = (url: string) => Promise<Result<DownloadedMedia, MediaError>>;

export function createHttpImageDownload(options: HttpImageDownloadOptions): HttpImageDownloadFn {
  const maxBytes = options.maxBytes ?? MEDIA_MAX_BYTES;

  return async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await options.fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return err({ code: 'DOWNLOAD', message: `unduh gambar gagal: HTTP ${res.status}` });
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        return err({ code: 'UNSUPPORTED', message: `bukan gambar: content-type ${contentType || '(kosong)'}` });
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return err({
          code: 'TOO_LARGE',
          message: `gambar ${buf.byteLength} byte melebihi batas ${maxBytes}`,
        });
      }
      return ok({ bytes: new Uint8Array(buf), contentType });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'DOWNLOAD', message: `unduh gambar gagal: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  };
}
