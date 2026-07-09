import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, safeUrl } from './escape.js';

describe('escape (anti-XSS)', () => {
  it('escape karakter HTML berbahaya', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("a & b ' c")).toBe('a &amp; b &#39; c');
  });

  it('escapeAttr sama dgn escapeHtml untuk nilai atribut', () => {
    expect(escapeAttr('" onload="evil')).toBe('&quot; onload=&quot;evil');
  });

  it('safeUrl mengizinkan http/https/mailto/tel & relatif', () => {
    expect(safeUrl('https://a.com')).toBe('https://a.com');
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('tel:+628')).toBe('tel:+628');
    expect(safeUrl('/kontak')).toBe('/kontak');
    expect(safeUrl('#anchor')).toBe('#anchor');
  });

  it('safeUrl memblok skema berbahaya → #', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('JavaScript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('vbscript:msgbox')).toBe('#');
    expect(safeUrl('  ')).toBe('#');
  });
});
