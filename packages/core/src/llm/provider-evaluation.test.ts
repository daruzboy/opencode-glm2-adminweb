import { describe, expect, it } from 'vitest';

import {
  createLlmEvaluationReport,
  recommendLlmProvider,
  type LlmPromptEvaluation,
} from './provider-evaluation.js';

function row(overrides: Partial<LlmPromptEvaluation>): LlmPromptEvaluation {
  return {
    promptId: 'p1',
    provider: 'deepseek',
    passed: true,
    qualityScore: 0.8,
    latencyMs: 1000,
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

describe('recommendLlmProvider', () => {
  it('recommends the provider with better pass rate and quality', () => {
    const result = recommendLlmProvider([
      row({ promptId: 'p1', provider: 'deepseek', passed: true, qualityScore: 0.8 }),
      row({ promptId: 'p2', provider: 'deepseek', passed: true, qualityScore: 0.75 }),
      row({ promptId: 'p1', provider: 'glm', passed: true, qualityScore: 0.6 }),
      row({ promptId: 'p2', provider: 'glm', passed: false, qualityScore: 0.2 }),
    ]);

    expect(result.recommendedProvider).toBe('deepseek');
    expect(result.scores[0]).toMatchObject({
      provider: 'deepseek',
      promptCount: 2,
      passRate: 1,
      averageQuality: 0.775,
    });
  });

  it('uses cost as deterministic tie breaker when scores match', () => {
    const result = recommendLlmProvider([
      row({ provider: 'deepseek', estimatedCostUsd: 0.002 }),
      row({ provider: 'glm', estimatedCostUsd: 0.001 }),
    ]);

    expect(result.recommendedProvider).toBe('glm');
  });

  it('returns an empty recommendation for an empty evaluation set', () => {
    expect(recommendLlmProvider([])).toEqual({
      recommendedProvider: '',
      scores: [],
    });
  });

  it('creates an evaluation report with missing prompt ids', () => {
    const result = createLlmEvaluationReport(
      ['p1', 'p2', 'p3'],
      [
        row({ promptId: 'p1', provider: 'deepseek' }),
        row({ promptId: 'p2', provider: 'glm' }),
      ],
    );

    expect(result.promptCount).toBe(3);
    expect(result.providerCount).toBe(2);
    expect(result.missingPromptIds).toEqual(['p3']);
  });
});
