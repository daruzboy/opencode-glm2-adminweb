import { describe, expect, it } from 'vitest';
import { parseTelegramAllowlist, resolveTenantForChat } from '../allowlist.js';

describe('parseTelegramAllowlist', () => {
  it('memetakan chat_id → tenantId', () => {
    const map = parseTelegramAllowlist('8037867441:clx123,99887766:clx456');

    expect(map.get('8037867441')).toBe('clx123');
    expect(map.get('99887766')).toBe('clx456');
    expect(map.size).toBe(2);
  });

  it('mentoleransi spasi di sekitar entri', () => {
    const map = parseTelegramAllowlist(' 111 : tenant-a , 222:tenant-b ');
    expect(map.get('111')).toBe('tenant-a');
    expect(map.get('222')).toBe('tenant-b');
  });

  // Satu typo tidak boleh mematikan bot untuk semua tenant lain.
  it('baris cacat dilewati, entri sah tetap terbaca', () => {
    const map = parseTelegramAllowlist('rusak,:tanpa-chat,333:,444:tenant-ok');

    expect(map.size).toBe(1);
    expect(map.get('444')).toBe('tenant-ok');
  });

  it('env kosong/undefined → allowlist kosong (semua chat ditolak)', () => {
    expect(parseTelegramAllowlist(undefined).size).toBe(0);
    expect(parseTelegramAllowlist('').size).toBe(0);
  });
});

describe('resolveTenantForChat', () => {
  it('chat terdaftar → tenantId', () => {
    const map = parseTelegramAllowlist('555:tenant-x');
    expect(resolveTenantForChat(map, '555')).toBe('tenant-x');
  });

  // Gerbang biaya: chat asing tak boleh menyentuh LLM.
  it('chat asing → null', () => {
    const map = parseTelegramAllowlist('555:tenant-x');
    expect(resolveTenantForChat(map, '999')).toBeNull();
  });
});
