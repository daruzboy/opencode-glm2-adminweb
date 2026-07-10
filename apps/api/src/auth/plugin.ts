// T-002auth: Fastify auth plugin. Ekstrak Bearer token → verifyToken via AuthPort →
// decorate request dengan { tenantId, userId, role }. Bila AUTH_DISABLED=1 (dev only),
// fallback ke header x-tenant-id (backward-compat, tak aman untuk produksi).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { tenantId, type AuthPayload, type AuthPort, type TenantId } from '@digimaestro/shared';
import { extractBearerToken } from '@digimaestro/adapters';

export interface AuthenticatedRequest extends FastifyRequest {
  tenant?: TenantId;
  authPayload?: AuthPayload;
}

export interface AuthPluginOptions {
  readonly auth: AuthPort;
  // Bila true: fallback ke x-tenant-id header (dev mode). Produksi = false.
  readonly allowHeaderFallback?: boolean;
}

// Resolve tenantId dari request: JWT bila ada, fallback header bila diizinkan.
// Return null bila tak ter-auth (route harus 401).
export async function resolveTenant(
  req: FastifyRequest,
  auth: AuthPort,
  allowFallback: boolean,
): Promise<{ tenantId: TenantId | null; payload: AuthPayload | null }> {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    const result = await auth.verifyToken(token);
    if (result.ok) {
      return { tenantId: result.value.tenantId, payload: result.value };
    }
    return { tenantId: null, payload: null };
  }
  // Dev fallback: x-tenant-id header (tidak aman, hanya dev/staging).
  if (allowFallback) {
    const headerTid = req.headers['x-tenant-id'];
    if (typeof headerTid === 'string' && headerTid.length > 0) {
      return { tenantId: tenantId(headerTid), payload: null };
    }
  }
  return { tenantId: null, payload: null };
}

export function registerAuthPlugin(app: FastifyInstance, options: AuthPluginOptions): void {
  const { auth, allowHeaderFallback = false } = options;

  // Decorate semua request dgn resolveTenant (dipanggil per-route, bukan global hook,
  // agar route publik /healthz & /api/auth/token tak butuh auth).
  app.decorate('resolveTenant', (req: FastifyRequest) =>
    resolveTenant(req, auth, allowHeaderFallback),
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    resolveTenant(req: FastifyRequest): Promise<{ tenantId: TenantId | null; payload: AuthPayload | null }>;
  }
}

// Helper untuk route yang butuh auth wajib.
export async function requireTenant(
  req: FastifyRequest,
  app: FastifyInstance,
): Promise<TenantId | null> {
  const { tenantId } = await app.resolveTenant(req);
  return tenantId;
}
