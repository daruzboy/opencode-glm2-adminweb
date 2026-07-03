import { describe, expect, it, vi } from 'vitest';
import { tenantId } from '@digimaestro/shared';

import { AuditLogPrisma, type AuditLogDelegate } from '../audit-log-prisma.js';

function makeDelegate(create: ReturnType<typeof vi.fn>): AuditLogDelegate {
  return { create };
}

describe('AuditLogPrisma', () => {
  it('records tenant-scoped audit log entries', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const audit = new AuditLogPrisma(makeDelegate(create));

    const result = await audit.record({
      actor: 'agent',
      tenantId: tenantId('tA'),
      action: 'agent.tool.call',
      meta: { toolName: 'ops_get_job_status', outcome: 'ok' },
    });

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: {
        actor: 'agent',
        tenantId: 'tA',
        action: 'agent.tool.call',
        meta: { toolName: 'ops_get_job_status', outcome: 'ok' },
      },
    });
  });

  it('returns AuditLogError when delegate fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const audit = new AuditLogPrisma(makeDelegate(create));

    const result = await audit.record({
      actor: 'agent',
      tenantId: tenantId('tA'),
      action: 'agent.tool.call',
      meta: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('db down');
  });
});
