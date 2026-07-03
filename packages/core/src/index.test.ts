import { describe, it, expect } from 'vitest';
import { recommendLlmProvider, tenantId } from './index.js';

describe('core domain', () => {
  it('tenantId() returns the same string value', () => {
    const id = tenantId('t_123');
    expect(`${id}`).toBe('t_123');
  });

  it('exports LLM provider recommendation helper', () => {
    const result = recommendLlmProvider([]);
    expect(result.recommendedProvider).toBe('');
  });
});
