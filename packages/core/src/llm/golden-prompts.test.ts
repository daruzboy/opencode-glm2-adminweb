import { describe, expect, it } from 'vitest';

import { getLlmGoldenPrompt, LLM_GOLDEN_PROMPTS } from './golden-prompts.js';

describe('LLM_GOLDEN_PROMPTS', () => {
  it('contains exactly 20 unique evaluation prompts', () => {
    const ids = new Set(LLM_GOLDEN_PROMPTS.map((prompt) => prompt.id));

    expect(LLM_GOLDEN_PROMPTS).toHaveLength(20);
    expect(ids.size).toBe(20);
  });

  it('covers MVP-relevant business scenarios and evaluation signals', () => {
    expect(LLM_GOLDEN_PROMPTS.every((prompt) => prompt.prompt.length > 40)).toBe(true);
    expect(LLM_GOLDEN_PROMPTS.every((prompt) => prompt.expectedSections.length >= 2)).toBe(true);
    expect(LLM_GOLDEN_PROMPTS.every((prompt) => prompt.requiredSignals.length >= 3)).toBe(true);
    expect(LLM_GOLDEN_PROMPTS.some((prompt) => prompt.requiredSignals.includes('NEEDS_INFO'))).toBe(true);
  });

  it('finds a prompt by id', () => {
    expect(getLlmGoldenPrompt('gp-001-warung-bakso')?.industry).toBe('kuliner');
    expect(getLlmGoldenPrompt('missing')).toBeUndefined();
  });
});
