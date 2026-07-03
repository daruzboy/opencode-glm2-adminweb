import { describe, expect, it } from 'vitest';
import { buildServer, APP_NAME } from './index.js';
import { makeFakeDeps } from './chat/__tests__/helpers.js';

describe('api server', () => {
  it('GET /healthz → 200 ok', async () => {
    const f = makeFakeDeps();
    const app = await buildServer({ deps: f.deps });

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', name: APP_NAME });
    await app.close();
  });
});
