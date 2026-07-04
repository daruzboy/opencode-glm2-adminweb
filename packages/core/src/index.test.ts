import { describe, it, expect } from 'vitest';
import {
  LLM_GOLDEN_PROMPTS,
  createAgentToolRegistry,
  createLlmEvaluationReport,
  recommendLlmProvider,
  tenantId,
} from './index.js';

describe('core domain', () => {
  it('tenantId() returns the same string value', () => {
    const id = tenantId('t_123');
    expect(`${id}`).toBe('t_123');
  });

  it('exports LLM provider recommendation helper', () => {
    const result = recommendLlmProvider([]);
    expect(result.recommendedProvider).toBe('');
    expect(createLlmEvaluationReport([], []).promptCount).toBe(0);
  });

  it('exports LLM golden prompt set', () => {
    expect(LLM_GOLDEN_PROMPTS).toHaveLength(20);
  });

  it('exports agent tool registry factory', () => {
    expect(createAgentToolRegistry([]).name).toBe('AgentToolRegistry');
  });
});
