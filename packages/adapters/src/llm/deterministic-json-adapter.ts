// Adapter deterministik untuk test/dev T-050+.
// Berguna untuk menguji agent flow tanpa jaringan, API key, atau flakiness provider.

import { err, ok } from '@digimaestro/shared';
import type {
  LlmError,
  LlmJsonPort,
  LlmJsonRequest,
  LlmUsageLoggerPort,
  LlmUsageRecord,
  Result,
} from '@digimaestro/shared';

export type DeterministicLlmResponder = <T>(request: LlmJsonRequest<T>) => unknown;

export interface DeterministicLlmConfig {
  readonly responder: DeterministicLlmResponder;
  readonly provider?: string;
  readonly model?: string;
  readonly usageLogger?: LlmUsageLoggerPort;
  readonly inputTokenCostPer1M?: number;
  readonly outputTokenCostPer1M?: number;
}

export class DeterministicLlmJsonAdapter implements LlmJsonPort {
  readonly name = 'llm:deterministic' as const;

  constructor(private readonly config: DeterministicLlmResponder | DeterministicLlmConfig) {}

  async completeJson<T>(request: LlmJsonRequest<T>): Promise<Result<T, LlmError>> {
    const responder = typeof this.config === 'function' ? this.config : this.config.responder;
    const value = responder(request);
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      return err({
        code: 'INVALID_SCHEMA',
        message: parsed.error.message,
        retryable: false,
        attempt: 1,
      });
    }

    await this.maybeRecordUsage(request, parsed.data);
    return ok(parsed.data);
  }

  private async maybeRecordUsage<T>(request: LlmJsonRequest<T>, data: T): Promise<void> {
    if (typeof this.config === 'function') return;
    const logger = this.config.usageLogger;
    if (!logger) return;

    const promptTokens = estimateTokens(
      `${request.system} ${request.messages.map((message) => message.content).join(' ')}`,
    );
    const completionTokens = estimateTokens(JSON.stringify(data));
    const inputCost = this.config.inputTokenCostPer1M ?? 0;
    const outputCost = this.config.outputTokenCostPer1M ?? 0;
    const record: LlmUsageRecord = {
      tenantId: request.tenantId,
      jobId: request.jobId,
      task: request.task,
      provider: this.config.provider ?? 'deterministic',
      model: this.config.model ?? 'deterministic',
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      latencyMs: 0,
      estimatedCostUsd:
        (promptTokens / 1_000_000) * inputCost + (completionTokens / 1_000_000) * outputCost,
      createdAt: new Date().toISOString(),
    };
    const logged = await logger.recordUsage(record);
    if (!logged.ok) {
      // Deterministic adapter tidak membatalkan hasil evaluasi hanya karena logging gagal.
      void logged.error;
    }
  }
}

export function createDeterministicLlmJsonAdapter(
  responderOrConfig: DeterministicLlmResponder | DeterministicLlmConfig,
): DeterministicLlmJsonAdapter {
  return new DeterministicLlmJsonAdapter(responderOrConfig);
}

// Estimasi token kasar (≈4 char/token). Cukup untuk usage deterministik dev/eval.
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
