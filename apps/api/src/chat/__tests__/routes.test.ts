import { describe, expect, it } from 'vitest';
import { ok } from '@digimaestro/shared';
import { buildServer } from '../../index.js';
import { makeFakeDeps, msg } from './helpers.js';

describe('chat routes — REST history (tenant-scoped)', () => {
  it('GET /api/chat/:id/messages returns messages scoped by x-tenant-id', async () => {
    const f = makeFakeDeps();
    f.messages.findManyByConversation.mockResolvedValueOnce(
      ok([msg('m1', 'IN', 'hai', 'c1'), msg('m2', 'OUT', 'reply', 'c1')]),
    );
    const app = await buildServer({ deps: f.deps });

    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/c1/messages',
      headers: { 'x-tenant-id': 'tA' },
    });

    expect(res.statusCode).toBe(200);
    expect(f.messages.findManyByConversation).toHaveBeenCalledWith(expect.anything(), 'c1');
    expect(String((f.messages.findManyByConversation.mock.calls[0] as unknown[])[0])).toBe('tA');
    const body = res.json() as { id: string }[];
    expect(body.map((m) => m.id)).toEqual(['m1', 'm2']);
    await app.close();
  });

  it('rejects request without x-tenant-id (401)', async () => {
    const f = makeFakeDeps();
    const app = await buildServer({ deps: f.deps });

    const res = await app.inject({ method: 'GET', url: '/api/chat/c1/messages' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
