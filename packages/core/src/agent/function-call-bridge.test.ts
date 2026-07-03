import { describe, expect, it } from 'vitest';
import { ok, tenantId, type AgentToolDefinition } from '@digimaestro/shared';

import { createAgentToolRegistry } from './tool-registry.js';
import { executeFunctionToolCalls, type OpenAiFunctionToolCall } from './function-call-bridge.js';

const context = {
  tenantId: tenantId('tA'),
  actor: 'agent',
  scopes: ['ops'] as const,
};

const tool: AgentToolDefinition<unknown, unknown> = {
  name: 'ops_get_job_status',
  description: 'Ambil status job.',
  scope: 'ops',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async (input) => ok({ input }),
};

function call(overrides: Partial<OpenAiFunctionToolCall> = {}): OpenAiFunctionToolCall {
  return {
    id: 'call-1',
    type: 'function',
    function: {
      name: 'ops_get_job_status',
      arguments: '{"jobId":"job-1"}',
    },
    ...overrides,
  };
}

describe('executeFunctionToolCalls', () => {
  it('executes provider tool calls through the registry and returns tool messages', async () => {
    const registry = createAgentToolRegistry([tool]);

    const [message] = await executeFunctionToolCalls(registry, [call()], context);

    expect(message).toEqual({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'ops_get_job_status',
      content: JSON.stringify({ ok: true, value: { input: { jobId: 'job-1' } } }),
    });
  });

  it('returns structured error content for invalid JSON arguments', async () => {
    const registry = createAgentToolRegistry([tool]);

    const [message] = await executeFunctionToolCalls(
      registry,
      [call({ function: { name: 'ops_get_job_status', arguments: '{bad json' } })],
      context,
    );

    expect(message?.role).toBe('tool');
    expect(JSON.parse(message?.content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('serializes registry errors for missing tools', async () => {
    const registry = createAgentToolRegistry([]);

    const [message] = await executeFunctionToolCalls(registry, [call()], context);

    expect(JSON.parse(message?.content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
