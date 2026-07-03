import { describe, expect, it } from 'vitest';
import { ok, tenantId, type AgentToolDefinition } from '@digimaestro/shared';

import { createAgentToolRegistry } from './tool-registry.js';

function tool(name: string, scope: AgentToolDefinition<unknown, unknown>['scope']): AgentToolDefinition<unknown, unknown> {
  return {
    name,
    description: name,
    scope,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, context) => ok({ actor: context.actor, tenantId: context.tenantId }),
  };
}

const context = {
  tenantId: tenantId('tA'),
  actor: 'agent',
  scopes: ['ops'] as const,
};

describe('InMemoryAgentToolRegistry', () => {
  it('lists only tools allowed by context scopes', () => {
    const registry = createAgentToolRegistry([
      tool('ops_get_job_status', 'ops'),
      tool('sitebuilder_get_site_outline', 'sitebuilder'),
    ]);

    expect(registry.listTools(context).map((item) => item.name)).toEqual(['ops_get_job_status']);
  });

  it('calls an allowed tool with tenant context', async () => {
    const registry = createAgentToolRegistry([tool('ops_get_job_status', 'ops')]);

    const result = await registry.callTool('ops_get_job_status', {}, context);

    expect(result).toEqual(ok({ actor: 'agent', tenantId: 'tA' }));
  });

  it('rejects missing or forbidden tools', async () => {
    const registry = createAgentToolRegistry([tool('sitebuilder_get_site_outline', 'sitebuilder')]);

    const missing = await registry.callTool('missing', {}, context);
    const forbidden = await registry.callTool('sitebuilder_get_site_outline', {}, context);

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error.code).toBe('FORBIDDEN');
  });
});
