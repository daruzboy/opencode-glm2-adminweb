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
export * from './prisma/llm-usage-query-prisma.js';
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
export * from './publish/mobirise-site-builder.js';
export * from './redis/with-deadline.js';
export * from './editor/editor-web-handoff.js';
export * from './templates/template-manifest.js';
export * from './templates/template-source.js';
export * from './templates/slot-contract.js';
export * from './templates/template-indexer.js';
export * from './templates/template-catalog.js';
export * from './publish/bullmq-publish-queue.js';
export * from './publish/bullmq-queue-factory.js';
export * from './publish/bullmq-queue-counter.js';
export * from './publish/publish-job-options.js';
export * from './builder/sitebuilder-tool-adapter.js';
export * from './auth/jwt-auth.js';
// Alert operasional (T-070).
export * from './alert/telegram-alert.js';
export * from './alert/throttled-alert.js';
export * from './alert/webhook-alert.js';
// Kanal Telegram (T-030tg) — rencana B; WABA menyusul saat verifikasi Meta tuntas.
export * from './llm/sanitize-tool-markup.js';
export * from './llm/runtime-llm-config.js';
// Media dari kanal (T-033).
export * from './media/telegram-media-download.js';
export * from './media/sharp-media-processor.js';
export * from './media/ftps-media-store.js';
export * from './sop/file-sop-provider.js';
export * from './images/unsplash-image-source.js';
export * from './images/pexels-image-source.js';
export * from './images/chained-image-source.js';
export * from './images/http-image-download.js';
export * from './prisma/media-repo-prisma.js';
export * from './prisma/tenant-profile-prisma.js';
export * from './prisma/admin-console-prisma.js';
export * from './prisma/feedback-repo-prisma.js';
export * from './prisma/ticket-repo-prisma.js';
export * from './prisma/invoice-repo-prisma.js';
// E1 billing (Midtrans).
export * from './billing/midtrans-gateway.js';
export * from './prisma/onboarding-prisma.js';
export * from './telegram/normalize.js';
export * from './telegram/allowlist.js';
export * from './telegram/telegram-channel.js';
export * from './telegram/rate-limited-channel.js';
export * from './telegram/redis-inbound-rate-limiter.js';
export * from './telegram/telegram-poller.js';
export * from './telegram/bullmq-chat-inbound-queue.js';
export * from './telegram/bullmq-chat-inbound-factory.js';
