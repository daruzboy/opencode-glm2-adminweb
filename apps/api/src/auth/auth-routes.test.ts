import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { JwtAuthPort } from '@digimaestro/adapters';
import { type AuthPort } from '@digimaestro/shared';
import { buildServer } from '../index.js';

function makeAuth(secret = 'test-secret'): AuthPort {
  return new JwtAuthPort({ secret });
}

async function makeApp(auth?: AuthPort): Promise<FastifyInstance> {
  return buildServer({
    auth: auth ? { auth, allowHeaderFallback: true, devTokenEnabled: true } : undefined,
  });
}

describe('POST /api/auth/token (T-002auth)', () => {
  it('issues JWT for valid tenantSlug → 200 + accessToken', async () => {
    const auth = makeAuth();
    const app = await makeApp(auth);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { tenantSlug: 'warung-demo' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeTruthy();
    expect(body.tenantId).toBe('warung-demo');

    // Verify the issued token
    const verified = await auth.verifyToken(body.accessToken);
    expect(verified.ok).toBe(true);

    await app.close();
  });

  it('400 when tenantSlug missing', async () => {
    const app = await makeApp(makeAuth());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: {},
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('accepts optional userId', async () => {
    const auth = makeAuth();
    const app = await makeApp(auth);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { tenantSlug: 't1', userId: 'user-abc' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const verified = await auth.verifyToken(body.accessToken);
    if (verified.ok) expect(verified.value.userId).toBe('user-abc');

    await app.close();
  });
});

describe('POST /api/auth/token — tenant admin diblok (audit 2026-07-16)', () => {
  it('403 saat tenantSlug = adminTenantId (token admin membuka rute lintas-tenant)', async () => {
    const auth = makeAuth();
    const app = await buildServer({
      auth: { auth, allowHeaderFallback: true, devTokenEnabled: true, adminTenantId: 'digimaestro-admin' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { tenantSlug: 'digimaestro-admin' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).accessToken).toBeUndefined();

    await app.close();
  });

  it('slug lain tetap 200 walau adminTenantId dikonfigurasi', async () => {
    const auth = makeAuth();
    const app = await buildServer({
      auth: { auth, allowHeaderFallback: true, devTokenEnabled: true, adminTenantId: 'digimaestro-admin' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/token',
      payload: { tenantSlug: 'warung-demo' },
    });

    expect(res.statusCode).toBe(200);

    await app.close();
  });
});

describe('/healthz remains public (no auth needed)', () => {
  it('GET /healthz → 200 without auth', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
