// Rute publish (T-063, BRU-02; POST /api/websites/:websiteId/publish). Approval-first:
// klien menyetujui revisi → enqueue job publish → 202 Accepted + jobId. Tenant resolusi v0
// via header x-tenant-id (auth sungguhan T-002 menyusul; konten diambil tenant-scoped dari DB).

import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { handlePublishRequest, type PublishRequestDeps } from '@digimaestro/core';

interface PublishParams {
  websiteId: string;
}

const publishBodySchema = z.object({
  revisionNumber: z.number().int().positive(),
});

export function registerPublishRoutes(app: FastifyInstance, deps: PublishRequestDeps): void {
  app.post(
    '/api/websites/:websiteId/publish',
    async (req: FastifyRequest<{ Params: PublishParams }>, reply: FastifyReply) => {
      // T-002auth: tenant dari token JWT (atau x-tenant-id fallback dev). Null → 401.
      const { tenantId: tid } = await app.resolveTenant(req);
      if (!tid) {
        return reply.code(401).send({ error: 'unauthorized: token/tenant tidak valid' });
      }

      const parsed = publishBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'revisionNumber (int positif) wajib' });
      }

      const outcome = await handlePublishRequest(deps, {
        tenantId: tid,
        websiteId: req.params.websiteId,
        revisionNumber: parsed.data.revisionNumber,
      });

      if (!outcome.ok) return reply.code(outcome.status).send({ error: outcome.message });
      return reply.code(outcome.status).send({ jobId: outcome.jobId, url: outcome.url });
    },
  );
}
