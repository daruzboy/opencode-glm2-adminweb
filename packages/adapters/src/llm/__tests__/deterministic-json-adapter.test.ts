import { describe, expect, it } from 'vitest';
import { ok, tenantId, type LlmJsonSchema } from '@digimaestro/shared';

import { createDeterministicLlmJsonAdapter } from '../deterministic-json-adapter.js';

interface IntentResult {
  readonly intent: 'interview' | 'revision' | 'status' | 'other';
}

const schema: LlmJsonSchema<IntentResult> = {
  safeParse(value) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'intent' in value &&
      ['interview', 'revision', 'status', 'other'].includes(String(value.intent))
    ) {
      return { success: true, data: { intent: value.intent as IntentResult['intent'] } };
    }
    return { success: false, error: { message: 'intent tidak valid' } };
  },
};

describe('DeterministicLlmJsonAdapter', () => {
  it('returns schema-validated deterministic output', async () => {
    const adapter = createDeterministicLlmJsonAdapter(() => ({ intent: 'interview' }));

    const result = await adapter.completeJson({
      tenantId: tenantId('tA'),
      task: 'intent',
      system: 'classify',
      messages: [{ role: 'user', content: 'buat website' }],
      schema,
      maxTokens: 50,
    });

    expect(result).toEqual(ok({ intent: 'interview' }));
  });

  it('returns INVALID_SCHEMA when deterministic output is wrong', async () => {
    const adapter = createDeterministicLlmJsonAdapter(() => ({ intent: 'unknown' }));

    const result = await adapter.completeJson({
      tenantId: tenantId('tA'),
      task: 'intent',
      system: 'classify',
      messages: [{ role: 'user', content: 'cek status' }],
      schema,
      maxTokens: 50,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'INVALID_SCHEMA',
        retryable: false,
        attempt: 1,
      });
    }
  });
});
