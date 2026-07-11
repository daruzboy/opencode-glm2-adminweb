import { describe, expect, it, vi } from 'vitest';
import { ok, err, type AuthPort } from '@digimaestro/shared';
import { resolveTenantWs } from './plugin.js';
import type { FastifyRequest } from 'fastify';

// LUBANG YANG DITUTUP (NFR-07): WS dulu memakai `?tenantId=` MENTAH. Siapa pun yang bisa
// menjangkau API dapat membuka `?tenantId=<tenant lain>` dan MEMBACA/MENULIS chat tenant
// lain. REST sudah tegak sejak T-002auth-wiring; WS tertinggal.
function req(query: Record<string, string>, authHeader?: string): FastifyRequest {
  return { query, headers: authHeader ? { authorization: authHeader } : {} } as FastifyRequest;
}

const auth: AuthPort = {
  name: 'AuthPort',
  issueToken: vi.fn(),
  verifyToken: vi.fn(async (token: string) =>
    token === 'valid'
      ? ok({ tenantId: 't-asli' as never, sub: 'u1', role: 'OWNER' as never })
      : err({ code: 'INVALID' as const, message: 'token tidak valid' }),
  ),
} as unknown as AuthPort;

describe('resolveTenantWs — auth WebSocket (NFR-07)', () => {
  it('token valid di query → tenant dari TOKEN (browser tak bisa set header di WS)', async () => {
    const r = await resolveTenantWs(req({ token: 'valid' }), auth, false);
    expect(r.tenantId).toBe('t-asli');
  });

  // INTI PERBAIKAN: tanpa token, WS tak boleh memberi akses apa pun saat auth aktif.
  it('TANPA token → ditolak (dulu: ?tenantId= diterima mentah)', async () => {
    const r = await resolveTenantWs(req({ tenantId: 't-korban' }), auth, false);
    expect(r.tenantId).toBeNull();
  });

  it('token PALSU → ditolak', async () => {
    const r = await resolveTenantWs(req({ token: 'palsu' }), auth, false);
    expect(r.tenantId).toBeNull();
  });

  // Serangan yang paling menggoda: token palsu + tenantId korban di query.
  it('token palsu + ?tenantId=<korban> → TIDAK jatuh ke query (tak bisa di-bypass)', async () => {
    const r = await resolveTenantWs(req({ token: 'palsu', tenantId: 't-korban' }), auth, false);
    expect(r.tenantId).toBeNull();
  });

  it('token valid + ?tenantId=<korban> → tenant tetap dari TOKEN (query diabaikan)', async () => {
    const r = await resolveTenantWs(req({ token: 'valid', tenantId: 't-korban' }), auth, false);
    expect(r.tenantId).toBe('t-asli');
  });

  it('header Authorization tetap didukung (klien non-browser)', async () => {
    const r = await resolveTenantWs(req({}, 'Bearer valid'), auth, false);
    expect(r.tenantId).toBe('t-asli');
  });

  // Mode dev: sama persis dengan fallback REST.
  it('dev (allowFallback) → ?tenantId= diterima', async () => {
    const r = await resolveTenantWs(req({ tenantId: 't-dev' }), auth, true);
    expect(r.tenantId).toBe('t-dev');
  });

  it('tanpa AuthPort (dev tanpa JWT) → ?tenantId= diterima', async () => {
    const r = await resolveTenantWs(req({ tenantId: 't-dev' }), undefined, false);
    expect(r.tenantId).toBe('t-dev');
  });
});
