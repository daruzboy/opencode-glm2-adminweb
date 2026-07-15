// P6: adapter ImageSourcePort → Unsplash API. Satu-satunya tempat detail Unsplash hidup.
//
// Kepatuhan API guideline Unsplash (syarat agar app tak diblokir):
// - Authorization: Client-ID <access key> (bukan OAuth — kita hanya search publik).
// - Foto di-download & di-rehost (dilakukan pemanggil), atribusi author WAJIB → kita
//   kembalikan authorName/authorUrl + pageUrl ber-UTM (utm_source=<app>&utm_medium=referral).
// - trackUsage: GET links.download_location saat foto BENAR-BENAR dipakai (bukan saat
//   search) — best-effort, error ditelan (kegagalan etiket tak boleh menggagalkan build).

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

export interface UnsplashImageSourceOptions {
  readonly accessKey: string;
  readonly fetch: FetchLike;
  // Nama app terdaftar di Unsplash — dipakai parameter UTM atribusi.
  readonly appName?: string;
  readonly timeoutMs?: number;
  // Lebar file yang diminta (urls.raw + w=). Dioptimasi ulang Sharp setelah download.
  readonly imageWidth?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_IMAGE_WIDTH = 1600;

interface UnsplashPhoto {
  id?: unknown;
  width?: unknown;
  height?: unknown;
  urls?: { raw?: unknown; regular?: unknown };
  links?: { html?: unknown; download_location?: unknown };
  user?: { name?: unknown; links?: { html?: unknown } };
}

export class UnsplashImageSource implements ImageSourcePort {
  readonly name = 'ImageSource' as const;
  readonly provider = 'unsplash' as const;

  constructor(private readonly options: UnsplashImageSourceOptions) {}

  async search(q: StockImageSearch): Promise<Result<readonly StockImage[], ImageSourceError>> {
    const perPage = Math.min(Math.max(q.perPage ?? 5, 1), 30);
    const url =
      'https://api.unsplash.com/search/photos' +
      `?query=${encodeURIComponent(q.query)}&per_page=${perPage}` +
      // landscape: slot gambar template (hero/galeri) hampir selalu melebar;
      // content_filter=high: saring konten tak pantas — situs UMKM keluarga.
      '&orientation=landscape&content_filter=high';

    const res = await this.request(url);
    if (!res.ok) return res;

    const results = (res.value as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      return err({ code: 'UNKNOWN', message: 'respons Unsplash tak berbentuk { results: [] }' });
    }
    return ok(results.map((p) => this.toImage(p as UnsplashPhoto)).filter((p): p is StockImage => p !== null));
  }

  async trackUsage(image: StockImage): Promise<void> {
    if (!image.downloadLocation) return;
    try {
      await this.request(image.downloadLocation);
    } catch {
      // best-effort
    }
  }

  private toImage(p: UnsplashPhoto): StockImage | null {
    const raw = typeof p.urls?.raw === 'string' ? p.urls.raw : undefined;
    const regular = typeof p.urls?.regular === 'string' ? p.urls.regular : undefined;
    const pageUrl = typeof p.links?.html === 'string' ? p.links.html : undefined;
    const authorName = typeof p.user?.name === 'string' ? p.user.name : undefined;
    const authorUrl = typeof p.user?.links?.html === 'string' ? p.user.links.html : undefined;
    if (typeof p.id !== 'string' || (!raw && !regular) || !pageUrl || !authorName) return null;

    const width = this.options.imageWidth ?? DEFAULT_IMAGE_WIDTH;
    // urls.raw selalu punya query (?ixid=…) → parameter ukuran aman ditambah dengan '&'.
    const imageUrl = raw
      ? `${raw}${raw.includes('?') ? '&' : '?'}w=${width}&q=85&fm=jpg&fit=max`
      : (regular as string);
    const utm = `utm_source=${encodeURIComponent(this.options.appName ?? 'digimaestro')}&utm_medium=referral`;

    return {
      provider: this.provider,
      providerId: p.id,
      imageUrl,
      pageUrl: `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}${utm}`,
      authorName,
      authorUrl: authorUrl ? `${authorUrl}${authorUrl.includes('?') ? '&' : '?'}${utm}` : pageUrl,
      width: typeof p.width === 'number' ? p.width : 0,
      height: typeof p.height === 'number' ? p.height : 0,
      ...(typeof p.links?.download_location === 'string'
        ? { downloadLocation: p.links.download_location }
        : {}),
    };
  }

  private async request(url: string): Promise<Result<unknown, ImageSourceError>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await this.options.fetch(url, {
        headers: {
          Authorization: `Client-ID ${this.options.accessKey}`,
          'Accept-Version': 'v1',
        },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        return err({ code: 'AUTH', message: `Unsplash menolak access key (HTTP ${res.status})` });
      }
      if (res.status === 429) {
        // Demo app Unsplash = 50 request/jam — pagar maxPerBuild di resolveSlotImages
        // menjaga jarak, tapi limit tetap bisa tersentuh saat banyak build beruntun.
        return err({ code: 'RATE_LIMIT', message: 'Unsplash rate limit tercapai (50/jam utk demo app)' });
      }
      if (!res.ok) {
        return err({ code: 'UNKNOWN', message: `Unsplash HTTP ${res.status}` });
      }
      return ok(await res.json());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'NETWORK', message: `Unsplash tak terjangkau: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  }
}
