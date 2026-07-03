// ESLint 9 flat config — digimaestro
// Aturan import antar-lapisan (boundary) akan diperketat seiring modul tumbuh.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Konsisten dengan SRS: larangan `any` tanpa justifikasi (komentar).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // ── Dependency rule (Clean Architecture / SOLID-D) ───────────────────────────
  // domain+application (core) & ports (shared) TIDAK boleh mengimpor adapter,
  // app, atau SDK vendor. Dijaga oleh mesin: pelanggaran = lint merah = PR ditolak.
  {
    files: ['packages/{core,shared}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
          ],
          patterns: [
            {
              group: ['@digimaestro/adapters', '@digimaestro/adapters/*'],
              message: 'Dependency rule (SOLID-D): core/shared tidak boleh import adapters.',
            },
            {
              group: ['@digimaestro/api', '@digimaestro/worker', '@digimaestro/portal', 'apps/*'],
              message: 'Dependency rule (SOLID-D): core/shared tidak boleh import apps.',
            },
            {
              group: [
                'openai',
                '@anthropic-ai/*',
                '@google/*',
                'xendit-node',
                '@xendit/*',
                'whatsapp*',
                '@modelcontextprotocol/*',
                'fastify',
                'bullmq',
                '@prisma/client',
                '@aws-sdk/*',
                'ssh2',
                'astro',
              ],
              message: 'Vendor SDK/infra hanya boleh diimpor di packages/adapters (SOLID-D).',
            },
          ],
        },
      ],
    },
  },
);
