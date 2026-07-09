import { describe, expect, it, vi } from 'vitest';
import { ok, tenantId, type LlmJsonSchema, type LlmUsageLoggerPort } from '@digimaestro/shared';
import {
  OpenAiCompatibleJsonAdapter,
  createDeepSeekJsonAdapter,
  createGlmJsonAdapter,
  type RuntimeFetch,
} from '../openai-compatible-json-adapter.js';

interface SitePlan {
  readonly title: string;
  readonly sections: readonly string[];
}

const sitePlanSchema: LlmJsonSchema<SitePlan> = {
  safeParse(value) {
    if (!isRecord(value) || typeof value.title !== 'string' || !Array.isArray(value.sections)) {
      return { success: false, error: { message: 'site plan invalid' } };
    }
    if (!value.sections.every((section) => typeof section === 'string') || value.sections.length === 0) {
      return { success: false, error: { message: 'sections must contain at least one item' } };
    }
    return { success: true, data: { title: value.title, sections: value.sections } };
  },
};

function request() {
  return {
    tenantId: tenantId('tA'),
    jobId: 'job-1',
    task: 'site_plan' as const,
    system: 'Buat rencana situs dalam JSON.',
    messages: [{ role: 'user' as const, content: 'Warung bakso dekat kampus.' }],
    schema: sitePlanSchema,
    maxTokens: 500,
  };
}

function response(content: string, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
      usage,
    }),
  };
}

function makeFetch(...contents: string[]): RuntimeFetch {
  const responses = contents.map((content) => response(content));
  return vi.fn(async () => responses.shift() ?? response(contents.at(-1) ?? '{}'));
}

function makeLogger(): {
  readonly logger: LlmUsageLoggerPort;
  readonly recordUsage: ReturnType<typeof vi.fn>;
} {
  const recordUsage = vi.fn().mockResolvedValue(ok(undefined));
  return {
    recordUsage,
    logger: {
      name: 'llm-usage:test',
      recordUsage,
    },
  };
}

describe('OpenAiCompatibleJsonAdapter', () => {
  it('returns schema-validated JSON and records usage', async () => {
    const fetch = makeFetch('{"title":"Warung Bakso","sections":["Hero"]}');
    const f = makeLogger();
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1/',
      fetch,
      usageLogger: f.logger,
      inputTokenCostPer1M: 1,
      outputTokenCostPer1M: 2,
    });

    const result = await adapter.completeJson(request());

    expect(result).toEqual(ok({ title: 'Warung Bakso', sections: ['Hero'] }));
    expect(fetch).toHaveBeenCalledWith(
      'https://llm.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          'content-type': 'application/json',
        }),
      }),
    );
    expect(f.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tA',
        jobId: 'job-1',
        task: 'site_plan',
        provider: 'deepseek',
        model: 'deepseek-chat',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        estimatedCostUsd: 0.00005,
      }),
    );
  });

  it('retries with a repair hint when provider JSON fails schema validation', async () => {
    const fetch = makeFetch(
      '{"title":"Warung Bakso","sections":[]}',
      '{"title":"Warung Bakso","sections":["Hero"]}',
    );
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'glm',
      model: 'glm-4.5',
      apiKey: 'test-key',
      baseUrl: 'https://glm.test/v1',
      fetch,
      maxAttempts: 2,
    });

    const result = await adapter.completeJson(request());

    expect(result).toEqual(ok({ title: 'Warung Bakso', sections: ['Hero'] }));
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetch.mock.calls[1]?.[1].body)) as {
      readonly messages: readonly { readonly content: string }[];
    };
    expect(secondBody.messages.at(-1)?.content).toContain('gagal validasi schema');
  });

  it('returns a retryable HTTP error for provider 5xx', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: vi.fn(),
    }));
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      fetch,
      maxAttempts: 1,
    });

    const result = await adapter.completeJson(request());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'HTTP',
        message: 'LLM HTTP 503',
        attempt: 1,
      });
    }
  });

  it('retries on HTTP 429 rate limit', async () => {
    const success = response('{"title":"Warung Bakso","sections":["Hero"]}');
    const queued: Array<{ ok: boolean; status: number; json: ReturnType<typeof vi.fn> }> = [
      { ok: false, status: 429, json: vi.fn() },
      success,
    ];
    const fetch = vi.fn(async () => queued.shift() ?? success);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      fetch,
      maxAttempts: 2,
      sleep,
    });

    const result = await adapter.completeJson(request());

    expect(result).toEqual(ok({ title: 'Warung Bakso', sections: ['Hero'] }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between transport retries and not after the last attempt', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: vi.fn() }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      fetch,
      maxAttempts: 3,
      retryInitialDelayMs: 100,
      retryMaxDelayMs: 4000,
      sleep,
    });

    const result = await adapter.completeJson(request());

    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    // Backoff hanya di antara percobaan (2×), bukan sesudah percobaan ke-3 (terakhir).
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([100, 200]);
  });

  it('does not retry permanent 4xx errors', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 400, json: vi.fn() }));
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      fetch,
      maxAttempts: 3,
    });

    const result = await adapter.completeJson(request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'HTTP', message: 'LLM HTTP 400' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts and returns a TIMEOUT error when the request exceeds timeoutMs', async () => {
    const fetch: RuntimeFetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const adapter = new OpenAiCompatibleJsonAdapter({
      provider: 'glm',
      model: 'glm-4.5',
      apiKey: 'test-key',
      baseUrl: 'https://glm.test/v1',
      fetch,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    const result = await adapter.completeJson(request());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
  });

  it('exposes provider-specific factories with default base urls', async () => {
    const deepSeekFetch = makeFetch('{"title":"DeepSeek","sections":["Hero"]}');
    const glmFetch = makeFetch('{"title":"GLM","sections":["Hero"]}');

    const deepSeek = createDeepSeekJsonAdapter({
      model: 'deepseek-chat',
      apiKey: 'test-key',
      fetch: deepSeekFetch,
    });
    const glm = createGlmJsonAdapter({
      model: 'glm-4.5',
      apiKey: 'test-key',
      fetch: glmFetch,
    });

    await deepSeek.completeJson(request());
    await glm.completeJson(request());

    expect(deepSeekFetch.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/chat/completions');
    expect(glmFetch.mock.calls[0]?.[0]).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
