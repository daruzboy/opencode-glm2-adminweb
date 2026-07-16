// T-002auth: Route penerbitan token (POST /api/auth/token). Endpoint dev/onboarding:
// terbitkan JWT untuk tenant berdasarkan slug. Produksi nyata: ganti dgn login WA OTP
// atau session (T-002 full). Body: { tenantSlug } → { accessToken, tenantId }.

import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPort } from '@digimaestro/shared';
import { tenantId } from '@digimaestro/shared';

const tokenBodySchema = z.object({
  tenantSlug: z.string().min(1),
  userId: z.string().min(1).optional(),
});

export interface AuthRouteDeps {
  readonly auth: AuthPort;
  // Tenant admin (ADMIN_TENANT_ID). Token OWNER tenant ini membuka rute lintas-tenant —
  // endpoint dev tak boleh mencetaknya (audit 2026-07-16).
  readonly adminTenantId?: string;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.post(
    '/api/auth/token',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = tokenBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'tenantSlug wajib (string)' });
      }

      if (deps.adminTenantId && parsed.data.tenantSlug === deps.adminTenantId) {
        return reply.code(403).send({ error: 'tenant admin tidak bisa dicetak dari endpoint dev' });
      }

      // v0: terbitkan token langsung dari slug. TIDAK ADA verifikasi password/OTP.
      // Ini hanya utk dev & onboarding awal. Produksi = login WA OTP (T-002 full).
      const result = await deps.auth.issueToken({
        tenantId: tenantId(parsed.data.tenantSlug),
        userId: parsed.data.userId ?? 'system',
        role: 'OWNER',
      });

      if (!result.ok) {
        return reply.code(500).send({ error: result.error.message });
      }

      return reply.send({
        accessToken: result.value,
        tenantId: parsed.data.tenantSlug,
      });
    },
  );
}
