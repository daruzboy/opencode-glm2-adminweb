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
  // AuthPort JWT. Bila undefined → mode DEV tanpa JWT (resolusi tenant via x-tenant-id).
  readonly auth?: AuthPort;
  // Bila true: izinkan fallback x-tenant-id meski auth aktif (dev; AUTH_DISABLED=1).
  // Produksi = false. Bila `auth` undefined, fallback SELALU aktif (tak ada JWT).
  readonly allowHeaderFallback?: boolean;
}

// Resolve tenantId dari request (T-002auth): JWT terverifikasi bila ada; else fallback
// x-tenant-id bila diizinkan (dev) atau bila tak ada AuthPort (mode dev tanpa JWT).
// Return null bila tak ter-auth → route WAJIB balas 401. Token ADA tapi invalid → null
// (tak jatuh ke header, agar token palsu tak bisa di-bypass dgn header).
export async function resolveTenant(
  req: FastifyRequest,
  auth: AuthPort | undefined,
  allowFallback: boolean,
): Promise<{ tenantId: TenantId | null; payload: AuthPayload | null }> {
  const token = extractBearerToken(req.headers.authorization);
  if (token && auth) {
    const result = await auth.verifyToken(token);
    if (result.ok) {
      return { tenantId: result.value.tenantId, payload: result.value };
    }
    return { tenantId: null, payload: null };
  }
  // Fallback header hanya bila diizinkan (dev) ATAU tak ada AuthPort (dev tanpa JWT).
  if (allowFallback || !auth) {
    const headerTid = req.headers['x-tenant-id'];
    if (typeof headerTid === 'string' && headerTid.length > 0) {
      return { tenantId: tenantId(headerTid), payload: null };
    }
  }
  return { tenantId: null, payload: null };
}

export function registerAuthPlugin(app: FastifyInstance, options: AuthPluginOptions = {}): void {
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
