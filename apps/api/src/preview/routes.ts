// Rute preview draft (T-064, FR-PUB-001; SRS §9 /api/preview/:revisionId?t=token).
// Selalu kirim header X-Robots-Tag noindex (pertahanan tambahan selain <meta robots>).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handlePreview, type PreviewDeps } from './handle-preview.js';

interface PreviewParams {
  revisionId: string;
}
interface PreviewQuery {
  t?: string;
  slug?: string;
}

export function registerPreviewRoutes(app: FastifyInstance, deps: PreviewDeps): void {
  app.get(
    '/api/preview/:revisionId',
    async (req: FastifyRequest<{ Params: PreviewParams; Querystring: PreviewQuery }>, reply: FastifyReply) => {
      const token = typeof req.query.t === 'string' ? req.query.t : '';
      const outcome = await handlePreview(deps, {
        revisionId: req.params.revisionId,
        token,
        slug: typeof req.query.slug === 'string' ? req.query.slug : undefined,
      });

      reply.header('x-robots-tag', 'noindex, nofollow');
      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.message });
      }
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(outcome.html);
    },
  );
}
