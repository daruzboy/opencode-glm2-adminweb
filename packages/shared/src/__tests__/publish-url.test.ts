import { describe, expect, it } from 'vitest';
import { parsePublishUrlMode, publicSiteUrl } from '../ports/publish.js';

// T-063p: bentuk URL situs klien. Satu sumber kebenaran — dipakai produsen job (core) DAN
// adapter deploy, supaya URL yang DIJANJIKAN ke pengguna sama persis dengan yang
// DIVERIFIKASI worker. Kalau berbeda, publish sukses pun akan dilaporkan gagal.
describe('publicSiteUrl', () => {
  it('subdomain → https://<slug>.<domain>', () => {
    expect(publicSiteUrl('sate-pak-dar', 'digimaestro.id', 'subdomain')).toBe(
      'https://sate-pak-dar.digimaestro.id',
    );
  });

  it('path → https://<domain>/<slug>/ (tanpa UAPI/subdomain)', () => {
    expect(publicSiteUrl('sate-pak-dar', 'digimaestro.id', 'path')).toBe(
      'https://digimaestro.id/sate-pak-dar/',
    );
  });
});

describe('parsePublishUrlMode', () => {
  it('"path" → path', () => {
    expect(parsePublishUrlMode('path')).toBe('path');
  });

  // Default aman: subdomain (FR-PUB-004b). Nilai ngawur tak boleh diam-diam mengubah
  // bentuk URL produk.
  it('undefined / nilai tak dikenal → subdomain', () => {
    expect(parsePublishUrlMode(undefined)).toBe('subdomain');
    expect(parsePublishUrlMode('ngawur')).toBe('subdomain');
  });
});
