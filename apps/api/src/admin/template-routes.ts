// P3: reindex registry template dari folder — dipanggil PO setelah menaruh/menyunting
// template (alur maintenance: edit di editor-web → taruh folder → reindex → AI melihatnya).
//
// Pagar akses sama ketatnya dengan /api/admin/usage (tenant admin + role OWNER; tanpa
// ADMIN_TENANT_ID rute tak dipasang sama sekali — fail-closed): endpoint ini membaca disk
// dan menulis registry — bukan untuk pelanggan.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface TemplateAdminDeps {
  readonly adminTenantId?: string;
  reindex(): Promise<{
    readonly indexed: string[];
    readonly deactivated: number;
    readonly errors: string[];
  }>;
}

export function registerTemplateAdminRoutes(app: FastifyInstance, deps: TemplateAdminDeps): void {
  if (!deps.adminTenantId) return;

  app.post('/api/admin/templates/reindex', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, payload } = await app.resolveTenant(req);
    if (!tenantId) return reply.code(401).send({ error: 'unauthorized' });
    if (tenantId !== deps.adminTenantId || payload?.role !== 'OWNER') {
      // 404, bukan 403 → tak membocorkan keberadaan endpoint admin.
      return reply.code(404).send({ error: 'not found' });
    }

    const report = await deps.reindex();
    // errors dilaporkan APA ADANYA: satu template rusak tak menghentikan yang lain,
    // tapi PO harus melihatnya di respons (bukan cuma log).
    return reply.send(report);
  });
}
