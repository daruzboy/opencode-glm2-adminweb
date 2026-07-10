// Port: autentikasi tenant (NFR-07, T-002auth). Implementasi konkret (JWT, session,
// WA OTP) di packages/adapters. Use case & route bergantung ke sini, bukan vendor.
//
// Tujuan: ganti resolusi tenant via header x-tenant-id (v0, impersonable) dengan
// token terverifikasi. Lapis guard repo (NFR-09) tetap jalan sebagai defense-in-depth.

import type { Port, Result, TenantId } from '../index.js';

export interface AuthPayload {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly role: string;
}

export type AuthErrorCode = 'INVALID_TOKEN' | 'EXPIRED' | 'MISSING' | 'UNKNOWN';

export interface AuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
}

export interface AuthPort extends Port {
  verifyToken(token: string): Promise<Result<AuthPayload, AuthError>>;
  issueToken(payload: AuthPayload): Promise<Result<string, AuthError>>;
}
