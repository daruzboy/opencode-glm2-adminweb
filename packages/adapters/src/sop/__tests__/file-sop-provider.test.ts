// SOP dari file: sunting → bot mengikuti TANPA restart (cache ber-mtime).

import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileSopProvider } from '../file-sop-provider.js';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sop-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createFileSopProvider', () => {
  it('membaca isi; perubahan file (mtime) → isi baru tanpa restart', async () => {
    const path = join(dir, 'sop.md');
    await writeFile(path, '# SOP v1\nTanya nama dulu.');
    const sop = createFileSopProvider({ path });

    expect(await sop()).toContain('SOP v1');

    await writeFile(path, '# SOP v2\nSapa dengan nama.');
    // mtime resolusi kasar di beberapa fs → paksa beda.
    await utimes(path, new Date(), new Date(Date.now() + 5_000));
    expect(await sop()).toContain('SOP v2');
  });

  it('file hilang → null (bot pakai persona bawaan), warn sekali; file kembali → isi lagi', async () => {
    const path = join(dir, 'hilang.md');
    const warns: string[] = [];
    const sop = createFileSopProvider({ path, logger: { warn: (m) => warns.push(m) } });

    expect(await sop()).toBeNull();
    expect(await sop()).toBeNull();
    expect(warns).toHaveLength(1);

    await writeFile(path, 'SOP kembali');
    expect(await sop()).toBe('SOP kembali');
  });

  it('SOP raksasa dipotong di maxChars (pagar biaya token)', async () => {
    const path = join(dir, 'besar.md');
    await writeFile(path, 'x'.repeat(500));
    const sop = createFileSopProvider({ path, maxChars: 100 });
    const isi = await sop();
    expect(isi).toContain('terpotong');
    expect((isi ?? '').length).toBeLessThan(200);
  });
});
