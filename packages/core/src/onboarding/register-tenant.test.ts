import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '@digimaestro/shared';
import {
  parseInviteCode,
  registerFromInvite,
  type RegisterDeps,
} from './register-tenant.js';

const INVITE = {
  id: 'inv1',
  code: 'KODE123',
  maxUses: 10,
  usedCount: 1,
  expiresAt: null,
  active: true,
};

function deps(over: Record<string, unknown> = {}): RegisterDeps {
  return {
    invites: (over.invites as never) ?? { redeem: vi.fn(async () => ok(INVITE)) },
    bindings: (over.bindings as never) ?? { resolve: vi.fn(), bind: vi.fn(async () => ok(undefined)) },
    tenants: (over.tenants as never) ?? { create: vi.fn(async () => ok('t-baru')) },
    quotaMessages: 100,
    quotaWebsites: 1,
    trialDays: 14,
    slugify: (n: string) => n.toLowerCase().replace(/\s+/g, '-'),
  } as RegisterDeps;
}

const REQ = { channel: 'TELEGRAM' as const, externalId: '555', text: 'daftar KODE123' };

// Pelanggan UMKM tak akan hafal sintaks perintah. Menolak mereka karena format = kehilangan
// pelanggan sungguhan.
describe('parseInviteCode — longgar tapi tidak sembarangan', () => {
  it.each([
    ['daftar KODE123', 'KODE123'],
    ['/daftar KODE123', 'KODE123'],
    ['DAFTAR kode-abc1', 'kode-abc1'],
    ['KODE123', 'KODE123'], // kode telanjang — pelanggan sering hanya menempel kodenya
  ])('%s → %s', (teks, kode) => {
    expect(parseInviteCode(teks)).toBe(kode);
  });

  it.each([
    ['halo'], // sapaan biasa BUKAN kode
    ['aku mau bikin website'],
    ['daftar'], // tanpa kode
    ['abcdef'], // huruf semua tanpa angka → kemungkinan besar kata biasa
  ])('%s → bukan kode', (teks) => {
    expect(parseInviteCode(teks)).toBeNull();
  });
});

describe('registerFromInvite', () => {
  it('kode valid → tenant dibuat + chat DIIKAT ke tenant itu', async () => {
    const d = deps();
    const res = await registerFromInvite(d, REQ);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.kind).toBe('registered');
    // Tanpa binding, pengguna akan mendaftar berulang & kode terpakai sia-sia.
    expect(d.bindings.bind).toHaveBeenCalledWith('t-baru', 'TELEGRAM', '555');
    // Kuota trial ikut ditanam (pagar biaya).
    expect(d.tenants.create).toHaveBeenCalledWith(
      expect.objectContaining({ quotaMessages: 100, quotaWebsites: 1, trialDays: 14 }),
    );
  });

  it('bukan upaya daftar ("halo") → needs_code, TIDAK menukarkan kode', async () => {
    const d = deps();
    const res = await registerFromInvite(d, { ...REQ, text: 'halo' });

    expect(res.ok && res.value.kind).toBe('needs_code');
    expect(d.invites.redeem).not.toHaveBeenCalled();
    expect(d.tenants.create).not.toHaveBeenCalled();
  });

  it.each([
    ['EXPIRED', 'kedaluwarsa'],
    ['EXHAUSTED', 'habis dipakai'],
    ['NOT_FOUND', 'tidak dikenali'],
  ])('kode %s → invalid_code, TIDAK membuat tenant', async (code, petunjuk) => {
    const invites = { redeem: vi.fn(async () => err({ code, message: 'x' })) };
    const d = deps({ invites });

    const res = await registerFromInvite(d, REQ);

    expect(res.ok).toBe(true);
    if (res.ok && res.value.kind === 'invalid_code') {
      expect(res.value.reason.toLowerCase()).toContain(petunjuk);
    }
    // Kode gagal → JANGAN buat tenant (kalau dibuat, orang bisa bikin tenant tanpa kode).
    expect(d.tenants.create).not.toHaveBeenCalled();
  });

  it('nama pengirim dipakai jadi nama tenant', async () => {
    const d = deps();
    await registerFromInvite(d, { ...REQ, senderName: 'Warung Sate Pak Dar' });

    expect(d.tenants.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Warung Sate Pak Dar', slug: 'warung-sate-pak-dar' }),
    );
  });

  // Tenant terlanjur ada tapi chat tak terikat → pengguna mendaftar lagi & kode habis sia-sia.
  it('bind gagal → err (bukan ditelan diam-diam)', async () => {
    const bindings = { resolve: vi.fn(), bind: vi.fn(async () => err({ code: 'UNKNOWN', message: 'db' })) };
    const res = await registerFromInvite(deps({ bindings }), REQ);

    expect(res.ok).toBe(false);
  });
});
