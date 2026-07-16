import { describe, expect, it, vi } from 'vitest';

import {
  assertTenantScoped,
  guardOperation,
  isTenantScopedModel,
  isTenantWriteScopedModel,
  TENANT_SCOPED_MODELS,
  TENANT_WRITE_SCOPED_MODELS,
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

  it('TENANT_SCOPED_MODELS matches schema (semua tabel domain ber-tenantId, akses tenant-scoped)', () => {
    expect([...TENANT_SCOPED_MODELS]).toEqual([
      'User',
      'Conversation',
      'Message',
      'Website',
      'AgentJob',
      'LlmUsage',
      'AuditLog',
      'TenantProfile',
      'Ticket',
      'Feedback',
      'MediaAsset',
    ]);
  });

  it('TENANT_WRITE_SCOPED_MODELS = tabel ber-tenantId yang dibaca via identitas non-tenant', () => {
    expect([...TENANT_WRITE_SCOPED_MODELS]).toEqual(['Invoice', 'ChannelBinding', 'AdminActing']);
  });

  // Model pasca-T-020 yang sebelumnya LOLOS guard (audit 2026-07-16).
  it('guards model baru: Ticket/Feedback/MediaAsset create tanpa tenantId → throw', () => {
    expect(() => assertTenantScoped('Ticket', 'create', { data: { subject: 'x' } })).toThrow(TenantGuardError);
    expect(() => assertTenantScoped('Feedback', 'create', { data: { text: 'x' } })).toThrow(TenantGuardError);
    expect(() => assertTenantScoped('MediaAsset', 'findMany', { where: {} })).toThrow(TenantGuardError);
  });

  it('upsert memeriksa tenantId di `create` (bukan `data`) — pola TenantProfile', () => {
    expect(() =>
      assertTenantScoped('TenantProfile', 'upsert', {
        where: { tenantId: 't1' },
        update: { customerName: 'Dar' },
        create: { tenantId: 't1', customerName: 'Dar' },
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped('TenantProfile', 'upsert', {
        where: { tenantId: 't1' },
        update: {},
        create: { customerName: 'Dar' }, // tanpa tenantId
      }),
    ).toThrow(TenantGuardError);
  });

  it('tingkat write-scoped: tulis wajib tenantId, baca via identitas lain dibiarkan', () => {
    // Tulis tanpa tenantId → ditolak.
    expect(() => assertTenantScoped('Invoice', 'create', { data: { orderId: 'o1' } })).toThrow(TenantGuardError);
    expect(() =>
      assertTenantScoped('AdminActing', 'upsert', {
        where: { chatId: 'c1' },
        update: { tenantId: 't1' },
        create: { chatId: 'c1' }, // tanpa tenantId
      }),
    ).toThrow(TenantGuardError);
    // Tulis lengkap → lolos.
    expect(() =>
      assertTenantScoped('ChannelBinding', 'create', {
        data: { tenantId: 't1', channel: 'TELEGRAM', externalId: '123' },
      }),
    ).not.toThrow();
    // Baca/update via identitas non-tenant (by design) → tidak dipaksa tenantId di where.
    expect(() =>
      assertTenantScoped('ChannelBinding', 'findUnique', {
        where: { channel_externalId: { channel: 'TELEGRAM', externalId: '123' } },
      }),
    ).not.toThrow();
    expect(() => assertTenantScoped('Invoice', 'update', { where: { id: 'inv1' }, data: { status: 'PAID' } })).not.toThrow();
    expect(() => assertTenantScoped('AdminActing', 'deleteMany', { where: { chatId: 'c1' } })).not.toThrow();
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

describe('isTenantScopedModel / isTenantWriteScopedModel', () => {
  it('narrows scoped vs non-scoped', () => {
    expect(isTenantScopedModel('Conversation')).toBe(true);
    expect(isTenantScopedModel('Tenant')).toBe(false);
    expect(isTenantWriteScopedModel('Invoice')).toBe(true);
    expect(isTenantWriteScopedModel('Ticket')).toBe(false);
  });
});
