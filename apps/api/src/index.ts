// apps/api — Fastify v5 (composition root). SRS §9. Web chat WS (T-040/FR-CHN-003),
// REST riwayat, healthz. Adapter disuntikkan di sini (SOLID-D).

import { pathToFileURL } from 'node:url';
import { createChatDeps } from './composition.js';
import { registerChatRoutes } from './chat/routes.js';
import { registerPreviewRoutes } from './preview/routes.js';
import type { ChatDeps } from './chat/handle-incoming.js';
import type { PreviewDeps } from './preview/handle-preview.js';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

export const APP_NAME = 'digimaestro-api';

export interface BuildServerOptions {
  deps?: ChatDeps;
  // Preview draft (T-064). Diregistrasi hanya bila disuntik (adapter Prisma Revision +
  // token menyusul); test menyuntik fake sehingga rute teruji tanpa DB.
  preview?: PreviewDeps;
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket);
  registerChatRoutes(app, opts.deps ?? createChatDeps());
  if (opts.preview) registerPreviewRoutes(app, opts.preview);
  app.get('/healthz', async () => ({ status: 'ok', name: APP_NAME }));
  return app;
}

export async function start(): Promise<void> {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? '3000');
  await app.listen({ port, host: '0.0.0.0' });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void start();
