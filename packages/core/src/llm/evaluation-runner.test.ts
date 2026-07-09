import { describe, expect, it } from 'vitest';
import { err, ok, tenantId, type LlmJsonPort, type LlmUsageLoggerPort } from '@digimaestro/shared';

import { runLlmEvaluation, summarizeLlmEvaluationRun } from './evaluation-runner.js';
import { LLM_GOLDEN_PROMPTS, type LlmGoldenPrompt } from './golden-prompts.js';

function factory(
  name: string,
  respond: (prompt: LlmGoldenPrompt) => unknown,
  prices?: { readonly inputTokenCostPer1M: number; readonly outputTokenCostPer1M: number },
): { readonly name: string; createPort(logger: LlmUsageLoggerPort): LlmJsonPort } {
  return {
    name,
    createPort(logger) {
      return {
        name: `fake:${name}`,
        async completeJson(request) {
          const prompt = LLM_GOLDEN_PROMPTS.find((item) => item.prompt === request.messages[0]?.content);
          const value = prompt ? respond(prompt) : {};
          const parsed = request.schema.safeParse(value);
          if (!parsed.success) {
            return err({ code: 'INVALID_SCHEMA', message: parsed.error.message, retryable: false, attempt: 1 });
          }
          const promptTokens = 100;
          const completionTokens = 50;
          const inputCost = prices?.inputTokenCostPer1M ?? 0;
          const outputCost = prices?.outputTokenCostPer1M ?? 0;
          await logger.recordUsage({
            tenantId: request.tenantId,
            jobId: request.jobId,
            task: request.task,
            provider: name,
            model: `${name}-eval`,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            latencyMs: 5,
            estimatedCostUsd: (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost,
            createdAt: new Date().toISOString(),
          });
          return ok(parsed.data);
        },
      };
    },
  };
}

// Provider yang membalas nilai tetap apa pun promptnya — untuk menguji skoring/ambang
// dengan golden prompt kustom yang tidak ada di LLM_GOLDEN_PROMPTS.
function fixedFactory(
  name: string,
  value: unknown,
): { readonly name: string; createPort(logger: LlmUsageLoggerPort): LlmJsonPort } {
  return {
    name,
    createPort() {
      return {
        name: `fixed:${name}`,
        async completeJson(request) {
          const parsed = request.schema.safeParse(value);
          if (!parsed.success) {
            return err({ code: 'INVALID_SCHEMA', message: parsed.error.message, retryable: false, attempt: 1 });
          }
          return ok(parsed.data);
        },
      };
    },
  };
}

const GOOD_PROMPTS = LLM_GOLDEN_PROMPTS.slice(0, 3);

describe('runLlmEvaluation', () => {
  it('scores signal coverage and recommends the higher-quality provider', async () => {
    const accurate = factory('accurate', (prompt) => ({
      summary: `${prompt.industry}: ${prompt.requiredSignals.join(', ')}`,
      sections: prompt.expectedSections,
      needsInfo: false,
    }));
    const vague = factory('vague', () => ({
      summary: 'rencana situs umum',
      sections: ['Hero'],
      needsInfo: false,
    }));

    const run = await runLlmEvaluation([accurate, vague], { prompts: GOOD_PROMPTS });
    const report = summarizeLlmEvaluationRun(run, GOOD_PROMPTS);

    expect(run.evaluations).toHaveLength(6);
    expect(run.failures).toHaveLength(0);
    const accurateRows = run.evaluations.filter((row) => row.provider === 'accurate');
    expect(accurateRows.every((row) => row.qualityScore === 1 && row.passed)).toBe(true);
    expect(report.recommendedProvider).toBe('accurate');
  });

  it('records a failure row when a provider returns invalid schema', async () => {
    const broken = factory('broken', () => ({ summary: 123 }));

    const run = await runLlmEvaluation([broken], { prompts: GOOD_PROMPTS.slice(0, 1) });

    expect(run.evaluations).toHaveLength(0);
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]?.provider).toBe('broken');
  });

  it('does not mark partial signal coverage as passed below the default threshold', async () => {
    const fourSignalPrompt: LlmGoldenPrompt = {
      id: 'custom-4sig',
      persona: 'umkm-owner',
      industry: 'uji',
      prompt: 'brief uji ambang',
      expectedSections: ['Hero'],
      requiredSignals: ['satu', 'dua', 'tiga', 'empat'],
    };
    const provider = fixedFactory('partial', { summary: 'hanya satu yang muncul', sections: [], needsInfo: false });

    const run = await runLlmEvaluation([provider], { prompts: [fourSignalPrompt] });
    expect(run.evaluations[0]?.qualityScore).toBeCloseTo(0.25);
    expect(run.evaluations[0]?.passed).toBe(false);

    const lenient = await runLlmEvaluation([provider], { prompts: [fourSignalPrompt], passThreshold: 0.2 });
    expect(lenient.evaluations[0]?.passed).toBe(true);
  });

  it('matches signals on word boundaries, not raw substrings', async () => {
    const menuPrompt: LlmGoldenPrompt = {
      id: 'custom-menu',
      persona: 'umkm-owner',
      industry: 'uji',
      prompt: 'brief uji kata',
      expectedSections: ['Hero'],
      requiredSignals: ['menu'],
    };

    const noMatch = await runLlmEvaluation(
      [fixedFactory('nomatch', { summary: 'menuju lokasi terdekat', sections: [], needsInfo: false })],
      { prompts: [menuPrompt] },
    );
    expect(noMatch.evaluations[0]?.qualityScore).toBe(0);

    const match = await runLlmEvaluation(
      [fixedFactory('match', { summary: 'lihat menu kami', sections: [], needsInfo: false })],
      { prompts: [menuPrompt] },
    );
    expect(match.evaluations[0]?.qualityScore).toBe(1);
  });

  it('captures estimated cost from usage logger into evaluation rows', async () => {
    const pricey = factory(
      'pricey',
      (prompt) => ({
        summary: prompt.requiredSignals.join(' '),
        sections: prompt.expectedSections,
        needsInfo: false,
      }),
      { inputTokenCostPer1M: 10, outputTokenCostPer1M: 20 },
    );

    const run = await runLlmEvaluation([pricey], {
      prompts: GOOD_PROMPTS.slice(0, 1),
      tenantId: tenantId('tEval'),
    });

    expect(run.evaluations[0]?.estimatedCostUsd).toBeGreaterThan(0);
  });
});
