import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';

import { LlmUsageLoggerPrisma, type LlmUsageDelegate } from '../llm-usage-logger-prisma.js';

function makeDelegate(create: ReturnType<typeof vi.fn>): LlmUsageDelegate {
  return { create };
}

describe('LlmUsageLoggerPrisma', () => {
  it('records usage with tenant scope and Prisma field names', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'usage-1' });
    const logger = new LlmUsageLoggerPrisma(makeDelegate(create));

    const result = await logger.recordUsage({
      tenantId: tenantId('tA'),
      jobId: 'job-1',
      task: 'site_plan',
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
      latencyMs: 250,
      estimatedCostUsd: 0.0002134,
      createdAt: '2026-07-04T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tA',
        jobId: 'job-1',
        provider: 'deepseek',
        task: 'site_plan',
        tokenIn: 123,
        tokenOut: 45,
        cost: '0.000213',
      },
    });
  });

  it('returns LlmError when usage logging fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const logger = new LlmUsageLoggerPrisma(makeDelegate(create));

    const result = await logger.recordUsage({
      tenantId: tenantId('tA'),
      task: 'intent',
      provider: 'glm',
      model: 'glm-4.5',
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      latencyMs: 10,
      estimatedCostUsd: 0,
      createdAt: '2026-07-04T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'USAGE_LOG',
        message: 'db down',
        retryable: true,
      });
    }
  });
});
