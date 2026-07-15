// Store config LLM runtime: cache mtime, sanitasi, save merge/hapus, fail-soft.

import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeLlmConfigStore } from './runtime-llm-config.js';

const dirs: string[] = [];
function tmpPath(): string {
  const d = mkdtempSync(join(tmpdir(), 'llmcfg-'));
  dirs.push(d);
  return join(d, 'llm-config.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('runtime llm config store', () => {
  it('file belum ada → {} (fail-soft); setelah save → terbaca; hapus via string kosong', async () => {
    const store = createRuntimeLlmConfigStore({ path: tmpPath() });
    expect(store.get()).toEqual({});
    expect(store.overrides()).toEqual({});

    await store.save({ model: 'deepseek-v4-pro', apiKey: 'sk-abcdef123456' });
    expect(store.get()).toEqual({ model: 'deepseek-v4-pro', apiKey: 'sk-abcdef123456' });
    expect(store.overrides()).toEqual({ model: 'deepseek-v4-pro', apiKey: 'sk-abcdef123456' });

    await store.save({ model: '' });
    expect(store.get()).toEqual({ apiKey: 'sk-abcdef123456' });
  });

  it('harga jadi override HANYA bila lengkap (input+output)', async () => {
    const store = createRuntimeLlmConfigStore({ path: tmpPath() });
    await store.save({ priceInputPer1M: 0.6 });
    expect(store.overrides().price).toBeUndefined();
    await store.save({ priceOutputPer1M: 1.7 });
    expect(store.overrides().price).toEqual({ inputPer1M: 0.6, outputPer1M: 1.7 });
  });

  it('nilai tak valid ditolak keras saat save; file rusak → {} tanpa melempar', async () => {
    const path = tmpPath();
    const store = createRuntimeLlmConfigStore({ path });
    await expect(store.save({ model: 'ada spasi!' })).rejects.toThrow('model');
    await expect(store.save({ priceInputPer1M: 99999 })).rejects.toThrow('priceInputPer1M');

    writeFileSync(path, '{bukan json');
    expect(store.get()).toEqual({});
  });

  it('perubahan file di luar store (sunting manual di host) terbaca via mtime', async () => {
    const path = tmpPath();
    const store = createRuntimeLlmConfigStore({ path });
    await store.save({ model: 'deepseek-v4-flash' });
    expect(store.get().model).toBe('deepseek-v4-flash');

    writeFileSync(path, JSON.stringify({ model: 'deepseek-v4-pro' }));
    // mtime resolusi kasar di beberapa fs — dorong maju eksplisit agar deterministik.
    const future = new Date(Date.now() + 5_000);
    utimesSync(path, future, future);
    expect(store.get().model).toBe('deepseek-v4-pro');
  });
});
