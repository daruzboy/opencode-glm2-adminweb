// Implementasi Port LlmUsageLoggerPort di atas Prisma (T-050).
// Delegate sempit menjaga adapter testable tanpa DB dan tetap tenant-scoped.

import { err, ok } from '@digimaestro/shared';
import type { LlmError, LlmUsageLoggerPort, LlmUsageRecord, Result } from '@digimaestro/shared';

export interface LlmUsageDelegate {
  create(args: {
    data: {
      tenantId: string;
      jobId?: string;
      provider: string;
      task: string;
      tokenIn: number;
      tokenOut: number;
      cost: string;
    };
  }): Promise<unknown>;
}

export class LlmUsageLoggerPrisma implements LlmUsageLoggerPort {
  readonly name = 'LlmUsageLogger' as const;

  constructor(private readonly delegate: LlmUsageDelegate) {}

  async recordUsage(record: LlmUsageRecord): Promise<Result<void, LlmError>> {
    try {
      await this.delegate.create({
        data: {
          tenantId: record.tenantId,
          jobId: record.jobId,
          provider: record.provider,
          task: record.task,
          tokenIn: record.promptTokens,
          tokenOut: record.completionTokens,
          cost: record.estimatedCostUsd.toFixed(6),
        },
      });
      return ok(undefined);
    } catch (e) {
      return err({
        code: 'USAGE_LOG',
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
        attempt: 0,
      });
    }
  }
}
