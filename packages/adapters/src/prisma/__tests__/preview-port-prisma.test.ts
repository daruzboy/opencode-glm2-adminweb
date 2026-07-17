import { describe, it, expect, vi } from 'vitest';
import { PreviewPortPrisma, type RevisionPreviewDelegate } from '../preview-port-prisma.js';
import { createPreviewDirToken, createPreviewToken, verifyPreviewToken } from '../preview-token.js';

const SECRET = 'rahasia-preview-uji';
const REV = { id: 'rev-1', websiteId: 'web-1', siteDoc: { website: { name: 'Warung Demo' } } };

function delegateWith(rev: typeof REV | null): RevisionPreviewDelegate {
  return { findUnique: vi.fn(async () => rev) };
}

describe('preview-token', () => {
  it('createPreviewToken deterministik; verify cocok utk token benar', () => {
    const t = createPreviewToken(SECRET, 'rev-1');
    expect(t).toBe(createPreviewToken(SECRET, 'rev-1')); // deterministik
    expect(verifyPreviewToken(SECRET, 'rev-1', t)).toBe(true);
  });

  it('verify false utk token salah, secret beda, revisionId beda, atau kosong', () => {
    const t = createPreviewToken(SECRET, 'rev-1');
    expect(verifyPreviewToken(SECRET, 'rev-1', 'salah')).toBe(false);
    expect(verifyPreviewToken('secret-lain', 'rev-1', t)).toBe(false);
    expect(verifyPreviewToken(SECRET, 'rev-2', t)).toBe(false);
    expect(verifyPreviewToken(SECRET, 'rev-1', '')).toBe(false);
  });

  // Satu implementasi utk tiga pemakai (dashboard, review gate, worker) — audit 2026-07-16.
  it('createPreviewDirToken deterministik, 12 hex, peka secret & websiteId', () => {
    const t = createPreviewDirToken(SECRET, 'web-1');
    expect(t).toBe(createPreviewDirToken(SECRET, 'web-1'));
    expect(t).toMatch(/^[0-9a-f]{12}$/);
    expect(createPreviewDirToken('secret-lain', 'web-1')).not.toBe(t);
    expect(createPreviewDirToken(SECRET, 'web-2')).not.toBe(t);
  });
});

describe('PreviewPortPrisma', () => {
  it('token benar + revisi ada → kembalikan revisi + siteDocument', async () => {
    const delegate = delegateWith(REV);
    const port = new PreviewPortPrisma(delegate, SECRET);
    const token = createPreviewToken(SECRET, 'rev-1');

    const res = await port.getPreview({ revisionId: 'rev-1', token });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({ revisionId: 'rev-1', websiteId: 'web-1', siteDocument: REV.siteDoc });
    }
  });

  it('token salah → null tanpa menyentuh DB (tak bocorkan keberadaan revisi)', async () => {
    const delegate = delegateWith(REV);
    const port = new PreviewPortPrisma(delegate, SECRET);

    const res = await port.getPreview({ revisionId: 'rev-1', token: 'token-palsu' });
    expect(res).toMatchObject({ ok: true, value: null });
    expect(delegate.findUnique).not.toHaveBeenCalled();
  });

  it('token benar tapi revisi tak ada → null', async () => {
    const port = new PreviewPortPrisma(delegateWith(null), SECRET);
    const token = createPreviewToken(SECRET, 'rev-1');
    const res = await port.getPreview({ revisionId: 'rev-1', token });
    expect(res).toMatchObject({ ok: true, value: null });
  });

  it('delegate melempar → err UNKNOWN', async () => {
    const delegate: RevisionPreviewDelegate = {
      findUnique: vi.fn(async () => {
        throw new Error('DB down');
      }),
    };
    const port = new PreviewPortPrisma(delegate, SECRET);
    const token = createPreviewToken(SECRET, 'rev-1');
    const res = await port.getPreview({ revisionId: 'rev-1', token });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('UNKNOWN');
      expect(res.error.message).toContain('DB down');
    }
  });
});
