// P5: dua rute gerbang review PO.
//
// POST /api/internal/review/complete — dipanggil editor-web saat PO menekan "Kirim ke
//   pelanggan". Auth: service token statis (timing-safe) — pemanggilnya MESIN, bukan
//   manusia ber-JWT. Payload membawa dokumen HASIL EDIT + korelasi (websiteId/revisionId/
//   editorProjectId) yang diverifikasi use case: panggilan palsu tak bisa memajukan situs
//   orang lain. Tanpa REVIEW_CALLBACK_TOKEN → rute tak dipasang (fail-closed, pola webhook).
//
// POST /api/admin/review/:revisionId/handoff — pemicu ULANG handoff (pemulihan saat
//   handoff pertama gagal). Pagar admin yang sama dgn /api/admin/usage.

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { completeAdminReview, type ReviewCompleteDeps } from '@digimaestro/core';
import { tenantId as asTenantId } from '@digimaestro/shared';

export interface ReviewRoutesDeps {
  readonly serviceToken: string;
  readonly review: ReviewCompleteDeps;
  // Cari tenant pemilik website (callback tak membawa tenantId — diambil dari DB
  // tepercaya, bukan dipercaya dari body).
  readonly tenantOfWebsite: (websiteId: string) => Promise<string | null>;
  // Re-trigger handoff (admin). Opsional — tanpa deps admin, hanya callback yang terpasang.
  readonly admin?: {
    readonly adminTenantId: string;
    readonly retrigger: (revisionId: string) => Promise<{ ok: boolean; message: string }>;
  };
}

interface CompleteBody {
  websiteId?: unknown;
  revisionId?: unknown;
  editorProjectId?: unknown;
  document?: unknown;
}

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerReviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps): void {
  app.post('/api/internal/review/complete', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.headers['x-service-token'];
    if (!tokenMatches(typeof token === 'string' ? token : undefined, deps.serviceToken)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const body = (req.body ?? {}) as CompleteBody;
    if (
      typeof body.websiteId !== 'string' ||
      typeof body.revisionId !== 'string' ||
      typeof body.editorProjectId !== 'string' ||
      body.document === undefined
    ) {
      return reply.code(400).send({ error: 'websiteId, revisionId, editorProjectId, document wajib' });
    }

    const tenant = await deps.tenantOfWebsite(body.websiteId);
    if (!tenant) return reply.code(404).send({ error: 'website tidak ditemukan' });

    const res = await completeAdminReview(deps.review, {
      tenantId: asTenantId(tenant),
      websiteId: body.websiteId,
      revisionId: body.revisionId,
      editorProjectId: body.editorProjectId,
      document: body.document,
    });
    if (!res.ok) {
      const status =
        res.error.code === 'NOT_FOUND' ? 404 : res.error.code === 'INVALID' || res.error.code === 'CORRELATION' ? 422 : 500;
      return reply.code(status).send({ error: res.error.message });
    }
    return reply.send(res.value);
  });

  if (!deps.admin) return;
  const admin = deps.admin;

  app.post(
    '/api/admin/review/:revisionId/handoff',
    async (req: FastifyRequest<{ Params: { revisionId: string } }>, reply: FastifyReply) => {
      const { tenantId, payload } = await app.resolveTenant(req);
      if (!tenantId) return reply.code(401).send({ error: 'unauthorized' });
      if (tenantId !== admin.adminTenantId || payload?.role !== 'OWNER') {
        return reply.code(404).send({ error: 'not found' }); // keberadaan endpoint tak bocor
      }
      const res = await admin.retrigger(req.params.revisionId);
      return reply.code(res.ok ? 200 : 502).send({ message: res.message });
    },
  );
}
