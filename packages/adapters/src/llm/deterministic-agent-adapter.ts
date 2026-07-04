// Adapter deterministik untuk test/dev T-053 (agent loop).
// Mengimplementasikan LlmAgentPort tanpa jaringan/API key: responder script menentukan
// keluaran (teks atau tool_calls) berdasarkan request + riwayat. Berguna menguji loop
// agent (multi-step, tool round-trip, guard maxSteps) secara offline & non-flaky.

import { err, ok } from '@digimaestro/shared';
import type {
  LlmAgentPort,
  LlmAgentRequest,
  LlmAgentResponse,
  LlmError,
  Result,
} from '@digimaestro/shared';

export type DeterministicAgentResponder = (request: LlmAgentRequest, step: number) => LlmAgentResponse;

export interface DeterministicLlmAgentConfig {
  readonly responder: DeterministicAgentResponder;
  readonly provider?: string;
  readonly model?: string;
}

export class DeterministicLlmAgentAdapter implements LlmAgentPort {
  readonly name: string;

  constructor(private readonly config: DeterministicLlmAgentConfig) {
    this.name = `llm-agent:${config.provider ?? 'deterministic'}`;
  }

  async completeWithTools(request: LlmAgentRequest): Promise<Result<LlmAgentResponse, LlmError>> {
    // Step diperkirakan dari jumlah pesan non-system setelah pesan user pertama.
    const step = countAgentSteps(request);
    try {
      const value = this.config.responder(request, step);
      return ok(value);
    } catch (e) {
      return err({
        code: 'UNKNOWN',
        message: e instanceof Error ? e.message : String(e),
        retryable: false,
        attempt: step,
      });
    }
  }
}

export function createDeterministicLlmAgentAdapter(
  config: DeterministicLlmAgentConfig,
): DeterministicLlmAgentAdapter {
  return new DeterministicLlmAgentAdapter(config);
}

// Step ke-0 = panggilan awal (1 pesan user). Setiap pasangan assistant(toolCalls)+tool
// menambah step. Hitung berdasarkan jumlah pesan role 'tool' di riwayat.
function countAgentSteps(request: LlmAgentRequest): number {
  const toolMessages = request.messages.filter((m) => m.role === 'tool').length;
  return toolMessages + 1;
}
