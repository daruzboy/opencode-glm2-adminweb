// P6: adapter ImageSourcePort → Pexels API. Fallback setelah Unsplash (rantai di
// chained-image-source). Lisensi Pexels: gratis dipakai & dimodifikasi; atribusi
// fotografer "dihargai" — kita catat selalu (konsisten dengan Unsplash yang mewajibkan).
// Pexels tak punya padanan download_location → trackUsage no-op.

import { err, ok } from '@digimaestro/shared';
import type {
  ImageSourceError,
  ImageSourcePort,
  Result,
  StockImage,
  StockImageSearch,
} from '@digimaestro/shared';

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface PexelsImageSourceOptions {
  readonly apiKey: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface PexelsPhoto {
  id?: unknown;
  width?: unknown;
  height?: unknown;
  url?: unknown;
  photographer?: unknown;
  photographer_url?: unknown;
  src?: { large2x?: unknown; large?: unknown };
}

export class PexelsImageSource implements ImageSourcePort {
  readonly name = 'ImageSource' as const;
  readonly provider = 'pexels' as const;

  constructor(private readonly options: PexelsImageSourceOptions) {}

  async search(q: StockImageSearch): Promise<Result<readonly StockImage[], ImageSourceError>> {
    const perPage = Math.min(Math.max(q.perPage ?? 5, 1), 30);
    const url =
      'https://api.pexels.com/v1/search' +
      `?query=${encodeURIComponent(q.query)}&per_page=${perPage}&orientation=landscape`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await this.options.fetch(url, {
        headers: { Authorization: this.options.apiKey },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        return err({ code: 'AUTH', message: `Pexels menolak API key (HTTP ${res.status})` });
      }
      if (res.status === 429) {
        return err({ code: 'RATE_LIMIT', message: 'Pexels rate limit tercapai' });
      }
      if (!res.ok) {
        return err({ code: 'UNKNOWN', message: `Pexels HTTP ${res.status}` });
      }
      const body = (await res.json()) as { photos?: unknown };
      if (!Array.isArray(body.photos)) {
        return err({ code: 'UNKNOWN', message: 'respons Pexels tak berbentuk { photos: [] }' });
      }
      return ok(
        body.photos.map((p) => toImage(p as PexelsPhoto)).filter((p): p is StockImage => p !== null),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'NETWORK', message: `Pexels tak terjangkau: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  }

  async trackUsage(): Promise<void> {
    // Pexels tak mensyaratkan sinyal pemakaian.
  }
}

function toImage(p: PexelsPhoto): StockImage | null {
  // large2x (~1880px) cukup untuk maxDimension 1600 Sharp; large (~940px) fallback.
  const file =
    typeof p.src?.large2x === 'string'
      ? p.src.large2x
      : typeof p.src?.large === 'string'
        ? p.src.large
        : undefined;
  const pageUrl = typeof p.url === 'string' ? p.url : undefined;
  const authorName = typeof p.photographer === 'string' ? p.photographer : undefined;
  if (typeof p.id !== 'number' || !file || !pageUrl || !authorName) return null;

  return {
    provider: 'pexels',
    providerId: String(p.id),
    imageUrl: file,
    pageUrl,
    authorName,
    authorUrl: typeof p.photographer_url === 'string' ? p.photographer_url : pageUrl,
    width: typeof p.width === 'number' ? p.width : 0,
    height: typeof p.height === 'number' ? p.height : 0,
  };
}
