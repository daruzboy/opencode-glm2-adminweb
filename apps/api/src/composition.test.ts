import { describe, expect, it, vi } from 'vitest';
import { ok, tenantId, type LlmJsonSchema, type LlmUsageLoggerPort } from '@digimaestro/shared';

import { createAuthDeps, createLlmJsonPort } from './composition.js';
import type { RuntimeFetch } from '@digimaestro/adapters';

const schema: LlmJsonSchema<{ readonly title: string }> = {
  safeParse(value) {
    if (typeof value === 'object' && value !== null && 'title' in value) {
      const title = (value as { readonly title?: unknown }).title;
      if (typeof title === 'string') return { success: true, data: { title } };
    }
    return { success: false, error: { message: 'title wajib string' } };
  },
};

function makeFetch(): RuntimeFetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"title":"OK"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
  }));
}

function makeLogger(): LlmUsageLoggerPort {
  return {
    name: 'usage:test',
    recordUsage: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

describe('composition LLM', () => {
  it('creates DeepSeek JSON adapter by default from env', async () => {
    const fetch = makeFetch();
    const llm = createLlmJsonPort({
      env: { DEEPSEEK_API_KEY: 'deepseek-key' },
      fetch,
      usageLogger: makeLogger(),
    });

    const result = await llm.completeJson({
      tenantId: tenantId('tA'),
      task: 'site_plan',
      system: 'JSON only',
      messages: [{ role: 'user', content: 'brief' }],
      schema,
      maxTokens: 100,
    });

    expect(result).toEqual(ok({ title: 'OK' }));
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.any(Object),
    );
  });

  it('creates GLM JSON adapter when selected', async () => {
    const fetch = makeFetch();
    const llm = createLlmJsonPort({
      env: { DIGIMAESTRO_LLM_PROVIDER: 'glm', GLM_API_KEY: 'glm-key' },
      fetch,
      usageLogger: makeLogger(),
    });

    await llm.completeJson({
      tenantId: tenantId('tA'),
      task: 'site_plan',
      system: 'JSON only',
      messages: [{ role: 'user', content: 'brief' }],
      schema,
      maxTokens: 100,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.any(Object),
    );
  });
});

describe('createAuthDeps — sabuk AUTH_DEV_TOKEN (audit 2026-07-16)', () => {
  it('menolak start bila AUTH_DEV_TOKEN=1 di NODE_ENV=production', () => {
    expect(() =>
      createAuthDeps({
        JWT_SECRET: 's3cret',
        AUTH_DEV_TOKEN: '1',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_DEV_TOKEN/);
  });

  it('AUTH_DEV_TOKEN=1 di luar produksi tetap boleh; ADMIN_TENANT_ID diteruskan', () => {
    const deps = createAuthDeps({
      JWT_SECRET: 's3cret',
      AUTH_DEV_TOKEN: '1',
      NODE_ENV: 'development',
      ADMIN_TENANT_ID: 'digimaestro-admin',
    } as NodeJS.ProcessEnv);
    expect(deps?.devTokenEnabled).toBe(true);
    expect(deps?.adminTenantId).toBe('digimaestro-admin');
  });

  it('produksi TANPA flag dev → aman (devTokenEnabled=false, tanpa throw)', () => {
    const deps = createAuthDeps({
      JWT_SECRET: 's3cret',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(deps?.devTokenEnabled).toBe(false);
  });
});
