import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';
import { OpenAiCompatibleAgentAdapter } from '../openai-compatible-agent-adapter.js';

function mockFetch(response: { ok: boolean; status: number; json: unknown }): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    statusText: '',
    json: () => Promise.resolve(response.json),
  });
}

const baseRequest = {
  tenantId: tenantId('tA'),
  task: 'interview' as const,
  system: 'You are helpful.',
  messages: [{ role: 'user' as const, content: 'Halo' }],
  tools: [],
  maxTokens: 512,
};

describe('OpenAiCompatibleAgentAdapter — text response', () => {
  it('parses text response from chat completions', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: {
        choices: [{ message: { role: 'assistant', content: 'Halo! Ada yang bisa dibantu?' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      },
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch,
    });

    const result = await adapter.completeWithTools(baseRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('text');
      if (result.value.kind === 'text') {
        expect(result.value.content).toBe('Halo! Ada yang bisa dibantu?');
      }
    }
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('OpenAiCompatibleAgentAdapter — tool_calls response', () => {
  it('parses tool_calls when present', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'sitebuilder_get_site_outline', arguments: '{"websiteId":"w1"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
      },
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch,
    });

    const result = await adapter.completeWithTools({
      ...baseRequest,
      tools: [{
        type: 'function' as const,
        function: { name: 'sitebuilder_get_site_outline', description: 'Get outline', parameters: { type: 'object', properties: {} } },
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'tool_calls') {
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls[0].function.name).toBe('sitebuilder_get_site_outline');
      expect(result.value.toolCalls[0].function.arguments).toBe('{"websiteId":"w1"}');
    }
  });
});

describe('OpenAiCompatibleAgentAdapter — retry on 429/5xx', () => {
  it('retries on 429 then succeeds', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }),
      });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch: fetchFn as never,
      retryInitialDelayMs: 1,
      sleep: () => Promise.resolve(),
    });

    const result = await adapter.completeWithTools(baseRequest);

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 then fails after maxAttempts', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch: fetchFn as never,
      maxAttempts: 2,
      retryInitialDelayMs: 1,
      sleep: () => Promise.resolve(),
    });

    const result = await adapter.completeWithTools(baseRequest);

    expect(result.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('OpenAiCompatibleAgentAdapter — factories', () => {
  it('createDeepSeekAgentAdapter uses deepseek baseUrl', () => {
    // Access via factory import is tested at composition level; here verify constructor.
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'key',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(adapter.name).toBe('llm-agent:deepseek');
  });
});

// T-053h — bocoran NYATA: pengguna Telegram menerima markup mentah
// "<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name=...>" sebagai isi pesan. Model menulis
// pemanggilan tool ke `content` saat tools dimatikan. Markup vendor harus BERHENTI di adapter.
describe('OpenAiCompatibleAgentAdapter — tool markup tak boleh bocor ke pengguna', () => {
  const DSML =
    '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="sitebuilder_build_site"> ' +
    '<｜｜DSML｜｜parameter name="businessName" string="true">Sate Pak Dar</｜｜DSML｜｜parameter>';

  function adapterWith(content: string) {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: { choices: [{ message: { role: 'assistant', content } }] },
    });
    return new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'k',
      baseUrl: 'https://api.test/v1',
      fetch,
    });
  }

  it('teks sah + markup → markup dibuang, teks sah tetap terkirim', async () => {
    const res = await adapterWith(`Siap, situsmu lagi kubangun ya!\n${DSML}`).completeWithTools(baseRequest);

    expect(res.ok).toBe(true);
    if (res.ok && res.value.kind === 'text') {
      expect(res.value.content).toContain('Siap, situsmu lagi kubangun ya!');
      expect(res.value.content).not.toContain('DSML');
    }
  });

  // Tak ada isi yang layak dikirim → error, supaya pemanggil memakai fallback sopan
  // ketimbang mengirim pesan kosong ke pengguna.
  it('balasan yang isinya HANYA markup → err PROVIDER (bukan pesan kosong)', async () => {
    const res = await adapterWith(DSML).completeWithTools(baseRequest);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PROVIDER');
  });

  it('teks normal tidak tersentuh', async () => {
    const res = await adapterWith('Situsmu sudah jadi 🎉').completeWithTools(baseRequest);

    expect(res.ok).toBe(true);
    if (res.ok && res.value.kind === 'text') {
      expect(res.value.content).toBe('Situsmu sudah jadi 🎉');
    }
  });
});

// Model kadang membalas content kosong/null. Meneruskannya = pesan gagal terkirim.
describe('OpenAiCompatibleAgentAdapter — balasan kosong', () => {
  it('content kosong → err PROVIDER (bukan text kosong)', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: { choices: [{ message: { role: 'assistant', content: '' } }] },
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek', model: 'm', apiKey: 'k', baseUrl: 'https://api.test/v1', fetch,
    });

    const res = await adapter.completeWithTools(baseRequest);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PROVIDER');
  });

  it('content null → err PROVIDER', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: { choices: [{ message: { role: 'assistant', content: null } }] },
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek', model: 'm', apiKey: 'k', baseUrl: 'https://api.test/v1', fetch,
    });

    const res = await adapter.completeWithTools(baseRequest);
    expect(res.ok).toBe(false);
  });
});

// Pesan error harus MENYEBUT sebabnya: "teks kosong" saja menyesatkan dan lama didiagnosis.
describe('OpenAiCompatibleAgentAdapter — anggaran token habis di reasoning', () => {
  it('content kosong + finish_reason length → err menyebut anggaran token', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '' } }] },
    });
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek', model: 'm', apiKey: 'k', baseUrl: 'https://api.test/v1', fetch,
    });

    const res = await adapter.completeWithTools(baseRequest);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain('anggaran token');
      expect(res.error.message).toContain('reasoning');
    }
  });
});

describe('OpenAiCompatibleAgentAdapter — overrides runtime', () => {
  it('model & API key dari overrides dipakai per panggilan (ganti tanpa rekonstruksi)', async () => {
    const fetch = mockFetch({
      ok: true,
      status: 200,
      json: {
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });
    let current: { model?: string; apiKey?: string } = {};
    const adapter = new OpenAiCompatibleAgentAdapter({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: 'env-key',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch,
      overrides: () => current,
    });

    await adapter.completeWithTools(baseRequest);
    let init = fetch.mock.calls[0]![1] as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe('Bearer env-key');
    expect(JSON.parse(init.body).model).toBe('deepseek-v4-flash');

    current = { model: 'deepseek-v4-pro', apiKey: 'dash-key' };
    await adapter.completeWithTools(baseRequest);
    init = fetch.mock.calls[1]![1] as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe('Bearer dash-key');
    expect(JSON.parse(init.body).model).toBe('deepseek-v4-pro');
  });
});
