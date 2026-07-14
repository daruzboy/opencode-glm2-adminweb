// P5: adapter handoff → API editor-web. Fetch di-inject → teruji offline.

import { describe, expect, it, vi } from 'vitest';
import { EditorWebHandoff } from '../editor-web-handoff.js';

const INPUT = {
  name: 'AI · Uji (uji)',
  templateId: 'tpl-a',
  document: { pages: [] },
  source: { websiteId: 'w1', revisionId: 'r1', returnUrl: 'http://api/cb' },
};

function adapter(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new EditorWebHandoff({
    apiBaseUrl: 'http://editor-api:5181/',
    appBaseUrl: 'http://editor:5180',
    serviceToken: 'rahasia',
    fetch: fetchImpl,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

describe('EditorWebHandoff.createProject', () => {
  it('sukses → projectId + editorUrl; token & payload terkirim benar', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ projectId: 'p9' }), { status: 201 }));
    const res = await adapter(f as never).createProject(INPUT);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.projectId).toBe('p9');
      expect(res.value.editorUrl).toBe('http://editor:5180/?project=p9');
    }
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://editor-api:5181/internal/handoff');
    expect((init.headers as Record<string, string>)['x-service-token']).toBe('rahasia');
    expect(JSON.parse(String(init.body)).source.revisionId).toBe('r1');
  });

  it('401 → AUTH (token salah harus kelihatan beda dari editor mati)', async () => {
    const f = vi.fn(async () => new Response('no', { status: 401 }));
    const res = await adapter(f as never).createProject(INPUT);
    expect(!res.ok && res.error.code).toBe('AUTH');
  });

  it('500 → HTTP; respons tanpa projectId → HTTP', async () => {
    const f500 = vi.fn(async () => new Response('boom', { status: 500 }));
    expect((await adapter(f500 as never).createProject(INPUT)).ok).toBe(false);

    const fKosong = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await adapter(fKosong as never).createProject(INPUT);
    expect(!res.ok && res.error.message).toContain('projectId');
  });

  it('fetch menggantung → gagal pada timeout (AbortController), bukan menggantung', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = adapter(f as never, 1_000).createProject(INPUT);
      await vi.advanceTimersByTimeAsync(1_001);
      const res = await pending;
      expect(res.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
