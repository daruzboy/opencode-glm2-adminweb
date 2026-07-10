import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { createCpanelUapiSubdomain, type UapiFetch, type UapiFetchResponse } from '../cpanel-uapi-subdomain.js';

function resp(status: number, body: string): UapiFetchResponse {
  return { ok: status >= 200 && status < 300, status, async text() { return body; } };
}

const cfg = (fetch: UapiFetch) => ({ host: 'panel.host', username: 'akun', apiToken: 'TOKEN123', fetch });
const input = { slug: 'toko', rootDomain: 'digimaestro.id', docroot: 'public_html/toko' };

describe('createCpanelUapiSubdomain', () => {
  it('sukses (status 1) → created:true + URL/param/auth benar', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetch: UapiFetch = async (url, init) => {
      seenUrl = url;
      seenAuth = init.headers.Authorization;
      return resp(200, JSON.stringify({ status: 1, errors: null }));
    };
    const port = createCpanelUapiSubdomain(cfg(fetch));
    const res = await port.ensureSubdomain(input);

    expect(res).toEqual({ ok: true, value: { subdomain: 'toko.digimaestro.id', created: true } });
    expect(seenUrl).toContain('https://panel.host:2083/execute/SubDomain/addsubdomain');
    expect(seenUrl).toContain('domain=toko');
    expect(seenUrl).toContain('rootdomain=digimaestro.id');
    expect(seenUrl).toContain('dir=public_html%2Ftoko'); // di-encode
    expect(seenAuth).toBe('cpanel akun:TOKEN123');
  });

  it('idempoten: subdomain sudah ada (status 0, errors "already exists") → created:false', async () => {
    const fetch: UapiFetch = async () => resp(200, JSON.stringify({ status: 0, errors: ['The subdomain “toko.digimaestro.id” already exists.'] }));
    const res = await createCpanelUapiSubdomain(cfg(fetch)).ensureSubdomain(input);
    expect(res).toEqual({ ok: true, value: { subdomain: 'toko.digimaestro.id', created: false } });
  });

  it('error UAPI nyata (status 0, error lain) → err SUBDOMAIN', async () => {
    const fetch: UapiFetch = async () => resp(200, JSON.stringify({ status: 0, errors: ['rootdomain tidak valid'] }));
    const res = await createCpanelUapiSubdomain(cfg(fetch)).ensureSubdomain(input);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('SUBDOMAIN');
      expect(res.error.message).toContain('rootdomain tidak valid');
    }
  });

  it('HTTP non-2xx → err SUBDOMAIN', async () => {
    const fetch: UapiFetch = async () => resp(403, 'Forbidden');
    const res = await createCpanelUapiSubdomain(cfg(fetch)).ensureSubdomain(input);
    expect(res).toMatchObject({ ok: false, error: { code: 'SUBDOMAIN' } });
  });

  it('body bukan JSON → err SUBDOMAIN', async () => {
    const fetch: UapiFetch = async () => resp(200, '<html>login</html>');
    const res = await createCpanelUapiSubdomain(cfg(fetch)).ensureSubdomain(input);
    expect(res).toMatchObject({ ok: false, error: { code: 'SUBDOMAIN' } });
  });

  it('fetch melempar → err SUBDOMAIN', async () => {
    const fetch: UapiFetch = async () => {
      throw new Error('ETIMEDOUT');
    };
    const res = await createCpanelUapiSubdomain(cfg(fetch)).ensureSubdomain(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toContain('ETIMEDOUT');
  });

  it('fallback Basic auth (password, tanpa apiToken) → header Basic base64', async () => {
    let seenAuth = '';
    const fetch: UapiFetch = async (_url, init) => {
      seenAuth = init.headers.Authorization;
      return resp(200, JSON.stringify({ status: 1 }));
    };
    const port = createCpanelUapiSubdomain({ host: 'panel.host', username: 'akun', password: 'rahasia', fetch });
    const res = await port.ensureSubdomain(input);
    expect(res.ok).toBe(true);
    expect(seenAuth).toBe(`Basic ${Buffer.from('akun:rahasia').toString('base64')}`);
  });

  it('tanpa apiToken maupun password → throw saat konstruksi (fail-fast)', () => {
    const fetch: UapiFetch = async () => resp(200, '{}');
    expect(() => createCpanelUapiSubdomain({ host: 'h', username: 'u', fetch })).toThrow(/apiToken atau password/);
  });
});
