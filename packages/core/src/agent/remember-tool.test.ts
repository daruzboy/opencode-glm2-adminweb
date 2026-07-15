// Memori per tenant: tool agent mencatat nama/preferensi (PO 2026-07-15).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import type { TenantProfileRepository } from '@digimaestro/shared';
import { createRememberCustomerTool } from './remember-tool.js';

const CTX = { tenantId: tenantId('t1'), actor: 'chatbot', scopes: ['sitebuilder'] } as const;

function fakeProfile(fail = false): TenantProfileRepository & { upsert: ReturnType<typeof vi.fn> } {
  return {
    name: 'TenantProfileRepository',
    get: vi.fn(async () => ok(null)),
    upsert: vi.fn(async () =>
      fail
        ? err({ code: 'UNKNOWN' as const, message: 'db mati' })
        : ok({ tenantId: 't1', customerName: 'Kak Rina', brief: null, notes: [], updatedAt: '' }),
    ),
  } as never;
}

describe('remember_customer', () => {
  it('menyimpan nama + catatan (dipangkas & di-trim)', async () => {
    const profile = fakeProfile();
    const tool = createRememberCustomerTool(profile);

    const res = await tool.execute(
      { customerName: '  Kak Rina ', note: ' suka warna abu-abu ' },
      CTX,
    );

    expect(res.ok).toBe(true);
    expect(profile.upsert).toHaveBeenCalledWith(CTX.tenantId, {
      customerName: 'Kak Rina',
      addNote: 'suka warna abu-abu',
    });
  });

  it('input kosong → INVALID_INPUT; repo gagal → error (bukan crash)', async () => {
    const tool = createRememberCustomerTool(fakeProfile());
    const empty = await tool.execute({}, CTX);
    expect(!empty.ok && empty.error.code).toBe('INVALID_INPUT');

    const failing = createRememberCustomerTool(fakeProfile(true));
    const res = await failing.execute({ note: 'x' }, CTX);
    expect(res.ok).toBe(false);
  });
});
