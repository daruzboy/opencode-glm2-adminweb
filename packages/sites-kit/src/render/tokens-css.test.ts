import { describe, it, expect } from 'vitest';
import { THEMES } from '../design-tokens.js';
import { designTokensToCssVars, renderStyles } from './tokens-css.js';

describe('design tokens → CSS (FR-CMP-003)', () => {
  const tokens = THEMES[0].tokens;

  it('menghasilkan custom properties untuk semua peran warna + skala', () => {
    const css = designTokensToCssVars(tokens);
    for (const role of ['primary', 'secondary', 'background', 'surface', 'text', 'muted', 'accent']) {
      expect(css).toContain(`--dm-color-${role}:`);
    }
    expect(css).toContain('--dm-radius:');
    expect(css).toContain('--dm-space:');
    expect(css).toContain('--dm-font-heading:');
  });

  it('memetakan enum radius/spacing/scale ke nilai konkret', () => {
    const css = designTokensToCssVars({
      ...tokens,
      radius: 'full',
      spacing: 'tight',
      typography: { ...tokens.typography, scale: 'compact' },
    });
    expect(css).toContain('--dm-radius:9999px');
    expect(css).toContain('--dm-space:2.5rem');
    expect(css).toContain('--dm-font-base:15px');
  });

  it('renderStyles membungkus dalam <style> dan hanya memakai var(--dm-*)', () => {
    const style = renderStyles(tokens);
    expect(style.startsWith('<style>')).toBe(true);
    expect(style.endsWith('</style>')).toBe(true);
    // Tak ada warna hex lepas di stylesheet dasar (styling via token).
    expect(/#[0-9a-f]{3,6}/i.test(style.replace(designTokensToCssVars(tokens), ''))).toBe(false);
  });

  it('deterministik', () => {
    expect(designTokensToCssVars(tokens)).toBe(designTokensToCssVars(tokens));
  });
});
