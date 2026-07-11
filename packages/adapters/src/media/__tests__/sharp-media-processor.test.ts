import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SharpMediaProcessor } from '../sharp-media-processor.js';

// Gambar sungguhan (bukan mock): satu-satunya cara membuktikan resize & WebP benar-benar
// terjadi. FR-MED-002 menuntut "format teroptimasi" — foto ponsel 4000px/5MB apa adanya
// akan merusak Lighthouse ≥ 90 (NFR-01).
async function jpeg(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  return new Uint8Array(buf);
}

describe('SharpMediaProcessor.optimize', () => {
  it('foto besar → diperkecil ke sisi terpanjang & dikonversi WebP', async () => {
    const input = await jpeg(4000, 3000); // meniru foto ponsel
    const res = await new SharpMediaProcessor({ maxDimension: 1600 }).optimize({
      bytes: input,
      contentType: 'image/jpeg',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.contentType).toBe('image/webp');
    expect(res.value.width).toBe(1600);
    expect(res.value.height).toBe(1200); // rasio aspek dipertahankan
    // Bukti "teroptimasi": hasilnya harus jauh lebih kecil dari aslinya.
    expect(res.value.bytes.byteLength).toBeLessThan(input.byteLength);
  });

  // Memperbesar foto kecil hanya menambah byte tanpa menambah detail.
  it('foto lebih kecil dari batas → TIDAK diperbesar', async () => {
    const input = await jpeg(400, 300);
    const res = await new SharpMediaProcessor({ maxDimension: 1600 }).optimize({
      bytes: input,
      contentType: 'image/jpeg',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.width).toBe(400);
      expect(res.value.height).toBe(300);
    }
  });

  // File rusak / bukan gambar tak boleh menjatuhkan worker.
  it('bukan gambar → err PROCESS, bukan crash', async () => {
    const res = await new SharpMediaProcessor().optimize({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/jpeg',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PROCESS');
  });
});
