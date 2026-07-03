import { describe, expect, it, vi } from 'vitest';

import {
  assertTenantScoped,
  guardOperation,
  isTenantScopedModel,
  TENANT_SCOPED_MODELS,
  TenantGuardError,
} from '../tenant-guard.js';

describe('assertTenantScoped — pure validator (NFR-09)', () => {
  it('throws when tenantId missing in `where` (findMany)', () => {
    expect(() => assertTenantScoped('Conversation', 'findMany', { where: {} })).toThrow(TenantGuardError);
  });

  it('throws when `where` is absent entirely', () => {
    expect(() => assertTenantScoped('Message', 'findMany', {})).toThrow(TenantGuardError);
  });

  it('passes when tenantId present in `where`', () => {
    expect(() => assertTenantScoped('Conversation', 'findMany', { where: { tenantId: 't1' } })).not.toThrow();
  });

  it('throws when tenantId missing in `data` (create)', () => {
    expect(() => assertTenantScoped('Conversation', 'create', { data: { channel: 'WA' } })).toThrow(
      TenantGuardError,
    );
  });

  it('passes when tenantId present in `data` (create)', () => {
    expect(() =>
      assertTenantScoped('Conversation', 'create', { data: { tenantId: 't1', channel: 'WA' } }),
    ).not.toThrow();
  });

  it('passes when every createMany row has tenantId', () => {
    expect(() =>
      assertTenantScoped('Message', 'createMany', {
        data: [{ tenantId: 't1', text: 'a' }, { tenantId: 't1', text: 'b' }],
      }),
    ).not.toThrow();
  });

  it('throws when any createMany row lacks tenantId', () => {
    expect(() =>
      assertTenantScoped('Message', 'createMany', { data: [{ tenantId: 't1' }, { text: 'b' }] }),
    ).toThrow(TenantGuardError);
  });

  it('ignores non-scoped models (Tenant has no tenantId; Revision scoped via Website)', () => {
    expect(() => assertTenantScoped('Tenant', 'findMany', { where: {} })).not.toThrow();
    expect(() => assertTenantScoped('Revision', 'create', { data: {} })).not.toThrow();
  });

  it('error carries model + operation for traceability', () => {
    try {
      assertTenantScoped('Website', 'findMany', { where: {} });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TenantGuardError);
      const guardErr = e as TenantGuardError;
      expect(guardErr.model).toBe('Website');
      expect(guardErr.operation).toBe('findMany');
      expect(guardErr.code).toBe('TENANT_GUARD_VIOLATION');
      expect(guardErr.message).toContain('Website.findMany');
    }
  });

  it('TENANT_SCOPED_MODELS matches schema T-020 (7 tenant-scoped domain tables)', () => {
    expect([...TENANT_SCOPED_MODELS]).toEqual([
      'User',
      'Conversation',
      'Message',
      'Website',
      'AgentJob',
      'LlmUsage',
      'AuditLog',
    ]);
  });
});

describe('guardOperation — runtime enforcement, DB never reached on violation', () => {
  it('rejects without tenantId and NEVER calls next (DB)', async () => {
    const next = vi.fn().mockResolvedValue('row');
    await expect(
      guardOperation('Conversation', 'findMany', { where: {} }, next),
    ).rejects.toBeInstanceOf(TenantGuardError);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next once and forwards its result when tenantId present', async () => {
    const next = vi.fn().mockResolvedValue('row');
    await expect(
      guardOperation('Conversation', 'findMany', { where: { tenantId: 't1' } }, next),
    ).resolves.toBe('row');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('isTenantScopedModel', () => {
  it('narrows scoped vs non-scoped', () => {
    expect(isTenantScopedModel('Conversation')).toBe(true);
    expect(isTenantScopedModel('Tenant')).toBe(false);
  });
});
