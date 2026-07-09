// packages/sites-kit — Design token & tema (T-060, FR-CMP-003).
// Seluruh styling komponen WAJIB mengacu token ini, bukan nilai lepas (SRS §2, ADR-3).
// Section props hanya berisi KONTEN; warna/tipografi/spacing berasal dari tema terpilih.

import { z } from 'zod';

// Token warna (peran semantik, bukan nilai lepas di komponen). Nilai = CSS color string.
export const colorTokensSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
  background: z.string().min(1),
  surface: z.string().min(1),
  text: z.string().min(1),
  muted: z.string().min(1),
  accent: z.string().min(1),
});

export const typographyTokensSchema = z.object({
  fontHeading: z.string().min(1),
  fontBody: z.string().min(1),
  scale: z.enum(['compact', 'default', 'spacious']),
});

export const designTokensSchema = z.object({
  colors: colorTokensSchema,
  typography: typographyTokensSchema,
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']),
  spacing: z.enum(['tight', 'default', 'relaxed']),
});

export type DesignTokens = z.infer<typeof designTokensSchema>;

export const themeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tokens: designTokensSchema,
});

export type Theme = z.infer<typeof themeSchema>;

// ≥3 tema bawaan (FR-CMP-003). Tenant memilih salah satu; agent boleh menyetel palet.
export const THEMES: readonly Theme[] = Object.freeze([
  {
    id: 'umkm-fresh',
    name: 'UMKM Fresh',
    tokens: {
      colors: {
        primary: '#16a34a',
        secondary: '#0f766e',
        background: '#ffffff',
        surface: '#f5f7f6',
        text: '#111827',
        muted: '#6b7280',
        accent: '#f59e0b',
      },
      typography: { fontHeading: 'Poppins', fontBody: 'Inter', scale: 'default' },
      radius: 'lg',
      spacing: 'default',
    },
  },
  {
    id: 'klasik-elegan',
    name: 'Klasik Elegan',
    tokens: {
      colors: {
        primary: '#1e3a8a',
        secondary: '#334155',
        background: '#fbfaf7',
        surface: '#ffffff',
        text: '#1f2937',
        muted: '#64748b',
        accent: '#b45309',
      },
      typography: { fontHeading: 'Playfair Display', fontBody: 'Source Sans 3', scale: 'spacious' },
      radius: 'sm',
      spacing: 'relaxed',
    },
  },
  {
    id: 'modern-berani',
    name: 'Modern Berani',
    tokens: {
      colors: {
        primary: '#7c3aed',
        secondary: '#db2777',
        background: '#0b0b12',
        surface: '#16161f',
        text: '#f5f5f7',
        muted: '#9ca3af',
        accent: '#22d3ee',
      },
      typography: { fontHeading: 'Space Grotesk', fontBody: 'Inter', scale: 'compact' },
      radius: 'md',
      spacing: 'tight',
    },
  },
]);

export const THEME_IDS: readonly string[] = Object.freeze(THEMES.map((t) => t.id));

export function findTheme(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
