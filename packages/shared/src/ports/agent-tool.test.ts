import { describe, expect, it } from 'vitest';
import { ok, tenantId } from '../index.js';
import { toOpenAiToolDefinition, type AgentToolDefinition } from './agent-tool.js';

describe('agent tool contracts', () => {
  it('converts a platform tool definition into an OpenAI-compatible function schema', () => {
    const tool: AgentToolDefinition<{ readonly websiteId: string }, { readonly title: string }> = {
      name: 'sitebuilder_get_site_outline',
      description: 'Ambil outline situs tenant.',
      scope: 'sitebuilder',
      inputSchema: {
        type: 'object',
        properties: { websiteId: { type: 'string' } },
        required: ['websiteId'],
        additionalProperties: false,
      },
      execute: async (_input, context) => ok({ title: `tenant:${context.tenantId}` }),
    };

    expect(toOpenAiToolDefinition(tool)).toEqual({
      type: 'function',
      function: {
        name: 'sitebuilder_get_site_outline',
        description: 'Ambil outline situs tenant.',
        parameters: tool.inputSchema,
      },
    });
  });

  it('keeps tenant context in tool execution contracts', async () => {
    const tool: AgentToolDefinition<unknown, { readonly tenant: string }> = {
      name: 'ops_get_job_status',
      description: 'Ambil status job.',
      scope: 'ops',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_input, context) => ok({ tenant: context.tenantId }),
    };

    const result = await tool.execute({}, {
      tenantId: tenantId('tA'),
      actor: 'agent',
      scopes: ['ops'],
    });

    expect(result).toEqual(ok({ tenant: 'tA' }));
  });
});
