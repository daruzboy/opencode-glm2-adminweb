import { describe, expect, it } from 'vitest';
import { ok, tenantId, type AgentToolDefinition, type OpenAiFunctionToolCall } from '@digimaestro/shared';

import { createAgentToolRegistry } from './tool-registry.js';
import { executeFunctionToolCalls } from './function-call-bridge.js';

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

  it('treats empty arguments as an empty object', async () => {
    const registry = createAgentToolRegistry([tool]);

    const [message] = await executeFunctionToolCalls(
      registry,
      [call({ function: { name: 'ops_get_job_status', arguments: '' } })],
      context,
    );

    expect(JSON.parse(message?.content ?? '{}')).toEqual({ ok: true, value: { input: {} } });
  });

  it('isolates a throwing tool so sibling calls in the batch still resolve', async () => {
    const throwing: AgentToolDefinition<unknown, unknown> = {
      name: 'ops_explode',
      description: 'meledak',
      scope: 'ops',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        throw new Error('boom');
      },
    };
    const registry = createAgentToolRegistry([tool, throwing]);
    const calls = [
      call({ id: 'ok-1', function: { name: 'ops_get_job_status', arguments: '{"jobId":"a"}' } }),
      call({ id: 'boom-1', function: { name: 'ops_explode', arguments: '{}' } }),
    ];

    const results = await executeFunctionToolCalls(registry, calls, context);

    expect(results.map((message) => message.toolCallId)).toEqual(['ok-1', 'boom-1']);
    expect(JSON.parse(results[0]?.content ?? '{}')).toMatchObject({ ok: true });
    expect(JSON.parse(results[1]?.content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
  });

  it('preserves call order when executing multiple calls in parallel', async () => {
    const registry = createAgentToolRegistry([tool]);
    const calls = [
      call({ id: 'call-a', function: { name: 'ops_get_job_status', arguments: '{"jobId":"a"}' } }),
      call({ id: 'call-b', function: { name: 'ops_get_job_status', arguments: '{"jobId":"b"}' } }),
      call({ id: 'call-c', function: { name: 'ops_get_job_status', arguments: '{"jobId":"c"}' } }),
    ];

    const results = await executeFunctionToolCalls(registry, calls, context);

    expect(results.map((message) => message.toolCallId)).toEqual(['call-a', 'call-b', 'call-c']);
    expect(results.map((message) => JSON.parse(message.content))).toEqual([
      { ok: true, value: { input: { jobId: 'a' } } },
      { ok: true, value: { input: { jobId: 'b' } } },
      { ok: true, value: { input: { jobId: 'c' } } },
    ]);
  });
});
