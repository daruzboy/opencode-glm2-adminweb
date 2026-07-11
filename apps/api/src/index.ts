// apps/api — Fastify v5 (composition root). SRS §9. Web chat WS (T-040/FR-CHN-003),
// REST riwayat, healthz. Adapter disuntikkan di sini (SOLID-D).

import { pathToFileURL } from 'node:url';
import {
  createAuthDeps,
  createChatDeps,
  createPreviewDeps,
  createPublishRequestDeps,
  createTelegramWebhookDeps,
} from './composition.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerAuthPlugin } from './auth/plugin.js';
import { registerChatRoutes } from './chat/routes.js';
import { registerTelegramWebhook } from './channel/telegram-webhook.js';
import { registerPreviewRoutes } from './preview/routes.js';
import { registerPublishRoutes } from './publish/routes.js';
import type { TelegramWebhookDeps } from './channel/telegram-webhook.js';
import type { ChatDeps } from './chat/handle-incoming.js';
import type { PreviewDeps } from './preview/handle-preview.js';
import type { PublishRequestDeps } from './publish/handle-publish.js';
import type { AuthDeps } from './composition.js';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

export const APP_NAME = 'digimaestro-api';

export interface BuildServerOptions {
  deps?: ChatDeps;
  preview?: PreviewDeps;
  publish?: PublishRequestDeps;
  auth?: AuthDeps;
  telegram?: TelegramWebhookDeps;
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket);

  // T-002auth: SELALU pasang resolver tenant. Dengan JWT (opts.auth) → rute wajib token;
  // tanpa JWT (dev) → fallback x-tenant-id. Rute terlindungi memanggil app.resolveTenant.
  registerAuthPlugin(
    app,
    opts.auth
      ? { auth: opts.auth.auth, allowHeaderFallback: opts.auth.allowHeaderFallback }
      : {},
  );
  // Endpoint penerbit token dev HANYA aktif bila di-flag (AUTH_DEV_TOKEN=1). Di produksi
  // tak terpasang → tak bisa mencetak token OWNER tanpa kredensial (menutup lubang #45).
  if (opts.auth?.devTokenEnabled) {
    registerAuthRoutes(app, { auth: opts.auth.auth });
  }

  registerChatRoutes(app, opts.deps ?? createChatDeps());
  // Webhook Telegram TIDAK memakai app.resolveTenant: pemanggilnya Telegram, bukan
  // pengguna ber-JWT. Tenant berasal dari allowlist chat_id (lihat telegram-webhook.ts).
  if (opts.telegram) registerTelegramWebhook(app, opts.telegram);
  if (opts.preview) registerPreviewRoutes(app, opts.preview);
  if (opts.publish) registerPublishRoutes(app, opts.publish);
  app.get('/healthz', async () => ({ status: 'ok', name: APP_NAME }));
  return app;
}

export async function start(): Promise<void> {
  const auth = createAuthDeps();
  const preview = process.env.PREVIEW_TOKEN_SECRET ? createPreviewDeps() : undefined;
  const publish = process.env.DATABASE_URL && process.env.REDIS_URL ? createPublishRequestDeps() : undefined;
  // Webhook aktif hanya bila secret disetel (sama seperti preview): tanpa secret, endpoint
  // publik ini tak boleh terpasang sama sekali.
  const telegram = process.env.TELEGRAM_WEBHOOK_SECRET ? createTelegramWebhookDeps() : undefined;
  const app = await buildServer({ auth, preview, publish, telegram });
  const port = Number(process.env.PORT ?? '3000');
  await app.listen({ port, host: '0.0.0.0' });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void start();
