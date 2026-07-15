// Store harga langganan runtime: sanitasi (diskon < normal), save merge/hapus, fail-soft.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeBillingConfigStore } from './runtime-billing-config.js';

const dirs: string[] = [];
function tmpPath(): string {
  const d = mkdtempSync(join(tmpdir(), 'bilcfg-'));
  dirs.push(d);
  return join(d, 'billing-config.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('runtime billing config store', () => {
  it('save harga awal + diskon; hapus diskon via string kosong', async () => {
    const store = createRuntimeBillingConfigStore({ path: tmpPath() });
    expect(store.get()).toEqual({});

    await store.save({ priceIdr: 89_000, discountIdr: 69_000, periodDays: 30 });
    expect(store.get()).toEqual({ priceIdr: 89_000, discountIdr: 69_000, periodDays: 30 });

    await store.save({ discountIdr: '' });
    expect(store.get()).toEqual({ priceIdr: 89_000, periodDays: 30 });
  });

  it('diskon >= harga normal ditolak keras; nilai bukan bilangan bulat ditolak', async () => {
    const store = createRuntimeBillingConfigStore({ path: tmpPath() });
    await store.save({ priceIdr: 89_000 });
    await expect(store.save({ discountIdr: 89_000 })).rejects.toThrow('lebih murah');
    await expect(store.save({ priceIdr: 88.5 })).rejects.toThrow('priceIdr');
  });

  it('file rusak → {} tanpa melempar (jatuh ke harga env)', () => {
    const path = tmpPath();
    writeFileSync(path, 'bukan-json');
    const store = createRuntimeBillingConfigStore({ path });
    expect(store.get()).toEqual({});
  });
});
