// T-082: rute laporan biaya AI. Dua audiens, dua tingkat akses:
//   GET /api/admin/usage   → LINTAS tenant (PO/admin). Butuh role OWNER + ADMIN_TENANT_ID.
//   GET /api/usage         → pemakaian TENANT SENDIRI (dari token; tak bisa mengintip tenant lain).
//
// Rute admin sengaja dipagari ketat: ia membaca data LINTAS-TENANT (satu-satunya di sistem),
// jadi kalau bocor, seluruh angka bisnis semua pelanggan ikut bocor.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildUsageReport, type UsageReportDeps } from '@digimaestro/core';

export interface UsageRoutesDeps extends UsageReportDeps {
  // Tenant yang boleh melihat laporan LINTAS-tenant. Kosong → rute admin tak dipasang.
  readonly adminTenantId?: string;
}

interface UsageQueryString {
  since?: string;
  until?: string;
}

export function registerUsageRoutes(app: FastifyInstance, deps: UsageRoutesDeps): void {
  // Pemakaian tenant sendiri — tenant diambil dari TOKEN, bukan dari query (NFR-09).
  app.get(
    '/api/usage',
    async (req: FastifyRequest<{ Querystring: UsageQueryString }>, reply: FastifyReply) => {
      const { tenantId } = await app.resolveTenant(req);
      if (!tenantId) return reply.code(401).send({ error: 'unauthorized' });

      const report = await buildUsageReport(deps, {
        tenantId,
        ...(req.query.since ? { since: req.query.since } : {}),
        ...(req.query.until ? { until: req.query.until } : {}),
      });
      if (!report.ok) return reply.code(500).send({ error: report.error.message });
      return reply.send(report.value);
    },
  );

  // Rute admin hanya ada bila ADMIN_TENANT_ID dikonfigurasi → produksi tanpa itu TIDAK
  // mengekspos data lintas-tenant sama sekali (fail-closed, pola yang sama dgn webhook).
  if (!deps.adminTenantId) return;

  app.get(
    '/api/admin/usage',
    async (req: FastifyRequest<{ Querystring: UsageQueryString }>, reply: FastifyReply) => {
      const { tenantId, payload } = await app.resolveTenant(req);
      if (!tenantId) return reply.code(401).send({ error: 'unauthorized' });

      // Dua syarat: tenant admin DAN role OWNER. Satu saja tak cukup.
      if (tenantId !== deps.adminTenantId || payload?.role !== 'OWNER') {
        // 404, bukan 403 → tak membocorkan keberadaan endpoint admin.
        return reply.code(404).send({ error: 'not found' });
      }

      const report = await buildUsageReport(deps, {
        ...(req.query.since ? { since: req.query.since } : {}),
        ...(req.query.until ? { until: req.query.until } : {}),
      });
      if (!report.ok) return reply.code(500).send({ error: report.error.message });
      return reply.send(report.value);
    },
  );
}
