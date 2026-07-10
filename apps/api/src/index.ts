// apps/api — Fastify v5 (composition root). SRS §9. Web chat WS (T-040/FR-CHN-003),
// REST riwayat, healthz. Adapter disuntikkan di sini (SOLID-D).

import { pathToFileURL } from 'node:url';
import { createChatDeps, createPreviewDeps, createPublishRequestDeps } from './composition.js';
import { registerChatRoutes } from './chat/routes.js';
import { registerPreviewRoutes } from './preview/routes.js';
import { registerPublishRoutes } from './publish/routes.js';
import type { ChatDeps } from './chat/handle-incoming.js';
import type { PreviewDeps } from './preview/handle-preview.js';
import type { PublishRequestDeps } from './publish/handle-publish.js';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

export const APP_NAME = 'digimaestro-api';

export interface BuildServerOptions {
  deps?: ChatDeps;
  // Preview draft (T-064). Diregistrasi hanya bila disuntik (adapter Prisma Revision +
  // token menyusul); test menyuntik fake sehingga rute teruji tanpa DB.
  preview?: PreviewDeps;
  // Publish request (T-063, BRU-02). Diregistrasi hanya bila disuntik; test pakai fake.
  publish?: PublishRequestDeps;
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket);
  registerChatRoutes(app, opts.deps ?? createChatDeps());
  if (opts.preview) registerPreviewRoutes(app, opts.preview);
  if (opts.publish) registerPublishRoutes(app, opts.publish);
  app.get('/healthz', async () => ({ status: 'ok', name: APP_NAME }));
  return app;
}

export async function start(): Promise<void> {
  // Rute preview draft diaktifkan hanya bila PREVIEW_TOKEN_SECRET diisi (butuh DB +
  // rahasia token). Tanpa itu, server tetap jalan tanpa /api/preview.
  const preview = process.env.PREVIEW_TOKEN_SECRET ? createPreviewDeps() : undefined;
  // Rute publish diaktifkan bila DATABASE_URL + REDIS_URL tersedia (butuh DB + antrean).
  const publish = process.env.DATABASE_URL && process.env.REDIS_URL ? createPublishRequestDeps() : undefined;
  const app = await buildServer({ preview, publish });
  const port = Number(process.env.PORT ?? '3000');
  await app.listen({ port, host: '0.0.0.0' });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryUrl) void start();
