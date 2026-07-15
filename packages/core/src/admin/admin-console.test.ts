// Konsol admin /konsumen (PO 2026-07-15) — deterministik, tanpa LLM, HANYA chat admin.

import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@digimaestro/shared';
import type { ActingStorePort, AdminDirectoryPort } from '@digimaestro/shared';
import { handleAdminCommand, isAdminCommand, type AdminConsoleDeps } from './admin-console.js';

const KOPI = { tenantId: 't-kopi', name: 'Kopi Senja', slug: 'kopi-senja', websiteSlug: 'kopi-senja', websiteStatus: 'DRAFTING' };
const BARBER = { tenantId: 't-barber', name: 'Barber Bro', slug: 'barber-bro', websiteSlug: null, websiteStatus: null };

function deps(over: Partial<Record<'listErr' | 'createErr', boolean>> = {}): AdminConsoleDeps & {
  acting: ActingStorePort & { state: Map<string, string> };
} {
  const state = new Map<string, string>();
  const acting: ActingStorePort & { state: Map<string, string> } = {
    name: 'ActingStore',
    state,
    async get(chatId) {
      return state.get(chatId) ?? null;
    },
    async set(chatId, tenantId) {
      state.set(chatId, tenantId);
    },
    async clear(chatId) {
      state.delete(chatId);
    },
  };
  const directory: AdminDirectoryPort = {
    name: 'AdminDirectory',
    list: vi.fn(async () =>
      over.listErr ? err({ code: 'UNKNOWN' as const, message: 'db mati' }) : ok([KOPI, BARBER]),
    ),
    findBySlug: vi.fn(async (slug: string) =>
      ok([KOPI, BARBER].find((c) => c.slug === slug) ?? null),
    ),
    create: vi.fn(async (name: string) =>
      over.createErr
        ? err({ code: 'CONFLICT' as const, message: 'slug sudah terpakai — coba nama lain.' })
        : ok({ tenantId: 't-baru', name, slug: 'nama-baru-x1', websiteSlug: null, websiteStatus: null }),
    ),
  };
  return { directory, acting, adminChatId: '999' };
}

describe('isAdminCommand', () => {
  it('mengenali /konsumen (case-insensitive, spasi depan); teks lain tidak', () => {
    expect(isAdminCommand('/konsumen daftar')).toBe(true);
    expect(isAdminCommand('  /KONSUMEN pilih kopi')).toBe(true);
    expect(isAdminCommand('bikinin website')).toBe(false);
    expect(isAdminCommand(null)).toBe(false);
  });
});

describe('handleAdminCommand', () => {
  it('chat BUKAN admin → null (perintah diperlakukan sbg teks biasa, konsol tak bocor)', async () => {
    const d = deps();
    const res = await handleAdminCommand(d, { chatId: '123', text: '/konsumen daftar' });
    expect(res.ok && res.value).toBeNull();
  });

  it('daftar → semua konsumen + tanda AKTIF', async () => {
    const d = deps();
    await d.acting.set('999', 't-barber');
    const res = await handleAdminCommand(d, { chatId: '999', text: '/konsumen daftar' });
    const reply = res.ok && res.value ? res.value.reply : '';
    expect(reply).toContain('Kopi Senja');
    expect(reply).toContain('Barber Bro');
    expect(reply).toMatch(/Barber Bro.*AKTIF/);
    expect(reply).not.toMatch(/Kopi Senja.*AKTIF/);
  });

  it('pilih <slug> → acting terpasang; slug asing → pesan jelas', async () => {
    const d = deps();
    const okRes = await handleAdminCommand(d, { chatId: '999', text: '/konsumen pilih kopi-senja' });
    expect(okRes.ok && okRes.value?.reply).toContain('Kopi Senja');
    expect(d.acting.state.get('999')).toBe('t-kopi');

    const miss = await handleAdminCommand(d, { chatId: '999', text: '/konsumen pilih zzz' });
    expect(miss.ok && miss.value?.reply).toContain('tidak ditemukan');
  });

  it('baru <nama> → konsumen dibuat + langsung aktif; tanpa nama → format', async () => {
    const d = deps();
    const res = await handleAdminCommand(d, { chatId: '999', text: '/konsumen baru Nama Baru' });
    expect(res.ok && res.value?.reply).toContain('AKTIF');
    expect(d.acting.state.get('999')).toBe('t-baru');

    const kosong = await handleAdminCommand(d, { chatId: '999', text: '/konsumen baru' });
    expect(kosong.ok && kosong.value?.reply).toContain('Format:');
  });

  it('siapa & selesai', async () => {
    const d = deps();
    await d.acting.set('999', 't-kopi');
    const who = await handleAdminCommand(d, { chatId: '999', text: '/konsumen siapa' });
    expect(who.ok && who.value?.reply).toContain('Kopi Senja');

    await handleAdminCommand(d, { chatId: '999', text: '/konsumen selesai' });
    expect(d.acting.state.has('999')).toBe(false);
  });

  it('verb tak dikenal → bantuan; error direktori → pesan gagal (bukan crash)', async () => {
    const d = deps();
    const help = await handleAdminCommand(d, { chatId: '999', text: '/konsumen' });
    expect(help.ok && help.value?.reply).toContain('/konsumen daftar');

    const dErr = deps({ listErr: true });
    const res = await handleAdminCommand(dErr, { chatId: '999', text: '/konsumen daftar' });
    expect(res.ok && res.value?.reply).toContain('Gagal');
  });
});
