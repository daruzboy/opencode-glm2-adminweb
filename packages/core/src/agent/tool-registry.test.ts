import { describe, expect, it } from 'vitest';
import { err, ok, tenantId, type AgentToolDefinition, type AuditLogPort } from '@digimaestro/shared';

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

  it('records every tool invocation to audit log when configured', async () => {
    const records: unknown[] = [];
    const auditLog: AuditLogPort = {
      name: 'audit:test',
      record: async (record) => {
        records.push(record);
        return ok(undefined);
      },
    };
    const registry = createAgentToolRegistry([tool('ops_get_job_status', 'ops')], auditLog);

    await registry.callTool('ops_get_job_status', {}, context);
    await registry.callTool('missing', {}, context);

    expect(records).toEqual([
      {
        actor: 'agent',
        tenantId: 'tA',
        action: 'agent.tool.call',
        meta: { toolName: 'ops_get_job_status', scope: 'ops', outcome: 'ok' },
      },
      {
        actor: 'agent',
        tenantId: 'tA',
        action: 'agent.tool.call',
        meta: { toolName: 'missing', scope: undefined, outcome: 'not_found' },
      },
    ]);
  });

  it('converts a thrown tool execution into an UNKNOWN error instead of rejecting', async () => {
    const throwing: AgentToolDefinition<unknown, unknown> = {
      name: 'ops_get_job_status',
      description: 'meledak',
      scope: 'ops',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        throw new Error('koneksi DB putus');
      },
    };
    const registry = createAgentToolRegistry([throwing]);

    const result = await registry.callTool('ops_get_job_status', {}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'UNKNOWN',
        message: 'tool gagal dieksekusi: koneksi DB putus',
      });
    }
  });

  it('fails closed when audit log cannot be recorded', async () => {
    const auditLog: AuditLogPort = {
      name: 'audit:test',
      record: async () => err({ code: 'UNKNOWN', message: 'audit down' }),
    };
    const registry = createAgentToolRegistry([tool('ops_get_job_status', 'ops')], auditLog);

    const result = await registry.callTool('ops_get_job_status', {}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'UNKNOWN',
        message: 'gagal mencatat audit tool: audit down',
      });
    }
  });
});
