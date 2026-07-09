import { describe, it, expect } from 'vitest';
import { THEMES, THEME_IDS, themeSchema, designTokensSchema, findTheme } from './design-tokens.js';

describe('design tokens & themes (FR-CMP-003)', () => {
  it('menyediakan ≥3 tema', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(3);
  });

  it('setiap tema valid terhadap themeSchema & id unik', () => {
    for (const theme of THEMES) {
      expect(themeSchema.safeParse(theme).success).toBe(true);
    }
    expect(new Set(THEME_IDS).size).toBe(THEMES.length);
  });

  it('menolak token tak lengkap (peran warna wajib)', () => {
    const bad = { colors: { primary: '#000' }, typography: { fontHeading: 'A', fontBody: 'B', scale: 'default' }, radius: 'md', spacing: 'default' };
    expect(designTokensSchema.safeParse(bad).success).toBe(false);
  });

  it('menolak enum radius/spacing tak dikenal', () => {
    const base = THEMES[0].tokens;
    expect(designTokensSchema.safeParse({ ...base, radius: 'huge' }).success).toBe(false);
    expect(designTokensSchema.safeParse({ ...base, spacing: 'zero' }).success).toBe(false);
  });

  it('findTheme mengembalikan tema by id, undefined bila tak ada', () => {
    expect(findTheme('umkm-fresh')?.name).toBe('UMKM Fresh');
    expect(findTheme('tidak-ada')).toBeUndefined();
  });
});
