// T-002auth: Implementasi AuthPort via JWT (jsonwebtoken). Satu-satunya file impor
// vendor jsonwebtoken (SOLID-D). verify = timing-safe via jsonwebtoken.verify.
// issue = sign dgn expiry. Secret dari constructor (composition root: env JWT_SECRET).

import jwt, { type SignOptions } from 'jsonwebtoken';
import { err, ok } from '@digimaestro/shared';
import type { AuthError, AuthPayload, AuthPort, Result } from '@digimaestro/shared';
import { tenantId as toTenantId } from '@digimaestro/shared';

export interface JwtAuthOptions {
  readonly secret: string;
  readonly expiresIn?: string; // default '7d'
}

interface JwtClaim {
  readonly tid: string; // tenantId
  readonly uid: string; // userId
  readonly role?: string;
}

export class JwtAuthPort implements AuthPort {
  readonly name = 'AuthPort' as const;
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(options: JwtAuthOptions) {
    this.secret = options.secret;
    this.expiresIn = options.expiresIn ?? '7d';
  }

  async verifyToken(token: string): Promise<Result<AuthPayload, AuthError>> {
    try {
      // Pinning algoritma (audit 2026-07-16): kita hanya menerbitkan HS256 — token ber-alg
      // lain (termasuk keluarga HMAC lain) ditolak, menutup kelas serangan alg-confusion.
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as JwtClaim;
      if (!decoded.tid || !decoded.uid) {
        return err({ code: 'INVALID_TOKEN', message: 'claim tidak lengkap' });
      }
      return ok({
        tenantId: toTenantId(decoded.tid),
        userId: decoded.uid,
        role: decoded.role ?? 'OWNER',
      });
    } catch (e) {
      if (e instanceof jwt.TokenExpiredError) {
        return err({ code: 'EXPIRED', message: 'token kedaluwarsa' });
      }
      if (e instanceof jwt.JsonWebTokenError) {
        return err({ code: 'INVALID_TOKEN', message: 'token tidak valid' });
      }
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async issueToken(payload: AuthPayload): Promise<Result<string, AuthError>> {
    try {
      const claim: JwtClaim = {
        tid: String(payload.tenantId),
        uid: payload.userId,
        role: payload.role,
      };
      const options: SignOptions = {
        algorithm: 'HS256',
        expiresIn: this.expiresIn as unknown as SignOptions['expiresIn'],
      };
      const token = jwt.sign(claim, this.secret, options);
      return ok(token);
    } catch (e) {
      return err({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }
}

// Helper: ekstrak Bearer token dari Authorization header.
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
