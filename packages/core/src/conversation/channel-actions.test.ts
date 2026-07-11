import { describe, expect, it } from 'vitest';
import { CHANNEL_ACTION_MAX_BYTES } from '@digimaestro/shared';
import { encodeChannelAction, parseChannelAction } from './channel-actions.js';

describe('encode/parse ChannelAction', () => {
  it('roundtrip publish & revise', () => {
    const pub = encodeChannelAction({ kind: 'publish', revisionNumber: 3 });
    const rev = encodeChannelAction({ kind: 'revise', revisionNumber: 12 });

    expect(pub).toBe('pub:3');
    expect(parseChannelAction(pub)).toEqual({ kind: 'publish', revisionNumber: 3 });
    expect(parseChannelAction(rev)).toEqual({ kind: 'revise', revisionNumber: 12 });
  });

  // callback_data Telegram dibatasi 64 byte — bentuk pendek harus muat walau revisi besar.
  it('muat dalam batas 64 byte callback_data', () => {
    const encoded = encodeChannelAction({ kind: 'publish', revisionNumber: 999999 });
    expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(CHANNEL_ACTION_MAX_BYTES);
  });
});

// callback_data dikirim balik oleh klien → bisa dikarang. Yang tak dikenali harus DITOLAK,
// bukan ditebak (mis. jadi NaN/0 lalu dipakai query).
describe('parseChannelAction — input tak tepercaya', () => {
  it.each([
    ['undefined', undefined],
    ['kosong', ''],
    ['tanpa pemisah', 'pub3'],
    ['verb tak dikenal', 'hapus:3'],
    ['arg bukan angka', 'pub:abc'],
    ['arg negatif', 'pub:-1'],
    ['arg nol', 'pub:0'],
    ['arg desimal', 'pub:1.5'],
    ['arg kosong', 'pub:'],
    ['injeksi', 'pub:1; DROP TABLE'],
  ])('%s → null', (_label, raw) => {
    expect(parseChannelAction(raw as string | undefined)).toBeNull();
  });
});
