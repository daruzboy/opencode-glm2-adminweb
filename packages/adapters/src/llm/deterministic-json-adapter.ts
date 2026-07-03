// Adapter deterministik untuk test/dev T-050+.
// Berguna untuk menguji agent flow tanpa jaringan, API key, atau flakiness provider.

import { err, ok } from '@digimaestro/shared';
import type { LlmError, LlmJsonPort, LlmJsonRequest, Result } from '@digimaestro/shared';

export type DeterministicLlmResponder = <T>(request: LlmJsonRequest<T>) => unknown;

export class DeterministicLlmJsonAdapter implements LlmJsonPort {
  readonly name = 'llm:deterministic' as const;

  constructor(private readonly responder: DeterministicLlmResponder) {}

  async completeJson<T>(request: LlmJsonRequest<T>): Promise<Result<T, LlmError>> {
    const value = this.responder(request);
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      return err({
        code: 'INVALID_SCHEMA',
        message: parsed.error.message,
        retryable: false,
        attempt: 1,
      });
    }
    return ok(parsed.data);
  }
}

export function createDeterministicLlmJsonAdapter(
  responder: DeterministicLlmResponder,
): DeterministicLlmJsonAdapter {
  return new DeterministicLlmJsonAdapter(responder);
}
