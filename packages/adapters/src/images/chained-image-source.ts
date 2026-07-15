// P6: rantai fallback sumber gambar stok — Unsplash dulu, Pexels berikutnya (urutan
// keputusan PO). Satu penyedia gagal/kosong bukan alasan slot dibiarkan kosong selama
// penyedia lain masih hidup. trackUsage dirutekan ke penyedia asal foto.

import { err, ok } from '@digimaestro/shared';
import type {
  ImageSourceError,
  ImageSourcePort,
  Result,
  StockImage,
  StockImageSearch,
} from '@digimaestro/shared';

export class ChainedImageSource implements ImageSourcePort {
  readonly name = 'ImageSource' as const;
  readonly provider = 'chained' as const;

  constructor(private readonly sources: readonly ImageSourcePort[]) {
    if (sources.length === 0) throw new Error('ChainedImageSource butuh minimal satu sumber');
  }

  async search(q: StockImageSearch): Promise<Result<readonly StockImage[], ImageSourceError>> {
    let lastError: ImageSourceError | null = null;
    for (const source of this.sources) {
      const res = await source.search(q);
      if (res.ok && res.value.length > 0) return res;
      if (!res.ok) lastError = res.error;
      // ok tapi kosong → coba penyedia berikutnya (indeks kueri berbeda antar penyedia).
    }
    // Semua kosong tanpa error = memang tak ada hasil (bukan kegagalan sistem).
    return lastError ? err(lastError) : ok([]);
  }

  async trackUsage(image: StockImage): Promise<void> {
    const source = this.sources.find((s) => s.provider === image.provider);
    await source?.trackUsage(image);
  }
}
