import { describe, expect, it } from 'vitest';
import { secureTokenEquals } from './token-equals.js';

describe('secureTokenEquals — perbandingan token konstan-waktu (audit 2026-07-16)', () => {
  it('true hanya saat sama persis', () => {
    expect(secureTokenEquals('rahasia-123', 'rahasia-123')).toBe(true);
  });

  it('false utk token salah, panjang beda, kosong, dan non-string — tanpa throw', () => {
    expect(secureTokenEquals('rahasia-124', 'rahasia-123')).toBe(false);
    expect(secureTokenEquals('pendek', 'rahasia-123')).toBe(false);
    expect(secureTokenEquals('', 'rahasia-123')).toBe(false);
    expect(secureTokenEquals(undefined, 'rahasia-123')).toBe(false);
    expect(secureTokenEquals(['rahasia-123'], 'rahasia-123')).toBe(false);
  });
});
