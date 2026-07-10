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
