// packages/adapters — implementasi konkret Port (SRS §9.1).
// Akan berisi: DeepSeekAdapter, GlmAdapter, XenditAdapter, WabaAdapter,
// CpanelUapiAdapter, RsyncSshDeployAdapter, UmamiAdapter, N8nWebhookAdapter, dst.
// Semua adapter harus lolos test kontrak yang sama (LSP / NFR-12).

import type { Port } from '@digimaestro/shared';

export type AdapterName =
  | 'deepseek'
  | 'glm'
  | 'xendit'
  | 'waba'
  | 'cpanel-ssh'
  | 'cpanel-ftp'
  | 'cf-pages'
  | 'umami'
  | 'n8n';

export const KNOWN_ADAPTERS: readonly AdapterName[] = Object.freeze([
  'deepseek',
  'glm',
  'xendit',
  'waba',
  'cpanel-ssh',
  'cpanel-ftp',
  'cf-pages',
  'umami',
  'n8n',
]);

export function isKnownAdapter(name: string): name is AdapterName {
  return (KNOWN_ADAPTERS as readonly string[]).includes(name);
}

// Helper untuk membungkus adapter agar konsisten dengan kontrak Port.
export function defineAdapter<T extends Port>(adapter: T): T {
  return adapter;
}

// Repository layer + tenant guard (T-021, NFR-09). Lihat prisma/* .
export * from './llm/deterministic-agent-adapter.js';
export * from './llm/deterministic-json-adapter.js';
export * from './llm/openai-compatible-json-adapter.js';
export * from './prisma/audit-log-prisma.js';
export * from './prisma/client.js';
export * from './prisma/tenant-guard.js';
export * from './prisma/conversation-repo-prisma.js';
export * from './prisma/message-repo-prisma.js';
export * from './prisma/llm-usage-logger-prisma.js';
