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
export * from './llm/openai-compatible-agent-adapter.js';
export * from './llm/openai-compatible-json-adapter.js';
export * from './prisma/audit-log-prisma.js';
export * from './prisma/client.js';
export * from './prisma/tenant-guard.js';
export * from './prisma/conversation-repo-prisma.js';
export * from './prisma/message-repo-prisma.js';
export * from './prisma/website-repo-prisma.js';
export * from './prisma/revision-repo-prisma.js';
export * from './prisma/llm-usage-logger-prisma.js';
export * from './prisma/preview-token.js';
export * from './prisma/preview-port-prisma.js';
export * from './prisma/publish-source-prisma.js';
export * from './publish/local-artifact-store.js';
export * from './publish/local-deploy.js';
export * from './publish/s3-artifact-store.js';
export * from './publish/aws-s3-client.js';
export * from './publish/remote-deploy.js';
export * from './publish/cpanel-sftp-deploy.js';
export * from './publish/ssh2-sftp-client.js';
export * from './publish/cpanel-ftp-deploy.js';
export * from './publish/basic-ftp-client.js';
export * from './publish/cpanel-uapi-subdomain.js';
export * from './publish/bullmq-publish-queue.js';
export * from './publish/bullmq-queue-factory.js';
export * from './publish/publish-job-options.js';
export * from './builder/sitebuilder-tool-adapter.js';
export * from './auth/jwt-auth.js';
// Kanal Telegram (T-030tg) — rencana B; WABA menyusul saat verifikasi Meta tuntas.
export * from './telegram/normalize.js';
export * from './telegram/allowlist.js';
export * from './telegram/telegram-channel.js';
export * from './telegram/bullmq-chat-inbound-queue.js';
export * from './telegram/bullmq-chat-inbound-factory.js';
