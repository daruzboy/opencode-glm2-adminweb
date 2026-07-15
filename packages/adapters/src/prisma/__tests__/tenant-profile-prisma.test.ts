// Memori per tenant: upsert append-notes ber-pangkas (PROFILE_MAX_NOTES).

import { describe, expect, it } from 'vitest';
import { PROFILE_MAX_NOTES, tenantId } from '@digimaestro/shared';
import {
  TenantProfileRepositoryPrisma,
  type TenantProfileDelegate,
} from '../tenant-profile-prisma.js';

const T = tenantId('t1');

function fakeDelegate(): TenantProfileDelegate & { row: Record<string, unknown> | null } {
  const state: { row: Record<string, unknown> | null } = { row: null };
  return {
    get row() {
      return state.row;
    },
    async findUnique() {
      return state.row as never;
    },
    async upsert({ update, create }) {
      state.row = state.row
        ? { ...state.row, ...update, updatedAt: new Date() }
        : { id: 'p1', ...create, customerName: create.customerName ?? null, brief: create.brief ?? null, notes: create.notes ?? [], updatedAt: new Date(), createdAt: new Date() };
      return state.row as never;
    },
  } as never;
}

describe('TenantProfileRepositoryPrisma', () => {
  it('upsert pertama membuat baris; addNote menambah (bukan mengganti)', async () => {
    const repo = new TenantProfileRepositoryPrisma(fakeDelegate());

    const a = await repo.upsert(T, { customerName: 'Kak Rina' });
    expect(a.ok && a.value.customerName).toBe('Kak Rina');

    await repo.upsert(T, { addNote: 'catatan 1' });
    const b = await repo.upsert(T, { addNote: 'catatan 2' });
    expect(b.ok && b.value.notes).toEqual(['catatan 1', 'catatan 2']);
    expect(b.ok && b.value.customerName).toBe('Kak Rina');
  });

  it('catatan dipangkas ke PROFILE_MAX_NOTES terbaru (konteks = biaya token tiap pesan)', async () => {
    const repo = new TenantProfileRepositoryPrisma(fakeDelegate());
    for (let i = 1; i <= PROFILE_MAX_NOTES + 5; i += 1) {
      await repo.upsert(T, { addNote: `catatan ${i}` });
    }
    const res = await repo.get(T);
    expect(res.ok && res.value?.notes.length).toBe(PROFILE_MAX_NOTES);
    expect(res.ok && res.value?.notes[0]).toBe('catatan 6');
  });
});
