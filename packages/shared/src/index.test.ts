import { describe, it, expect } from 'vitest';
import {
  domainEvent,
  err,
  ok,
  toOpenAiToolDefinition,
  type LlmJsonPort,
  type LlmJsonSchema,
} from './index.js';

describe('shared kernel', () => {
  it('ok() wraps a value', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });

  it('err() wraps an error', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('domainEvent() carries type + ISO timestamp', () => {
    const e = domainEvent('RevisionApproved');
    expect(e.type).toBe('RevisionApproved');
    expect(() => new Date(e.occurredAt).toISOString()).not.toThrow();
  });

  it('exports LLM port contracts', () => {
    const schema: LlmJsonSchema<{ readonly ok: true }> = {
      safeParse: () => ({ success: true, data: { ok: true } }),
    };
    const port: Pick<LlmJsonPort, 'name'> = { name: 'llm:test' };

    expect(schema.safeParse({}).success).toBe(true);
    expect(port.name).toBe('llm:test');
  });

  it('exports agent tool bridge helper', () => {
    expect(toOpenAiToolDefinition({
      name: 'ops_get_job_status',
      description: 'status',
      inputSchema: { type: 'object', properties: {} },
    }).type).toBe('function');
  });
});
