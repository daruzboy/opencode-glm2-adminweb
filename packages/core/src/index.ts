// packages/core — domain & application (use cases).
// Dependency rule: TIDAK boleh import adapters/SDK vendor. Hanya boleh import @digimaestro/shared.
// Modul konkret (conversation, agent, builder, publishing, billing, dll.) ditambahkan per backlog (SRS §4.1).

export { ok, err, type Result, type DomainEvent, domainEvent } from '@digimaestro/shared';

// Branding type untuk TenantId — mencegah tertukar dengan string biasa.
export type TenantId = string & { readonly __tenant: unique symbol };

export function tenantId(value: string): TenantId {
  return value as TenantId;
}

// Status website state machine (FRD §6.1) — domain murni, tanpa I/O.
export type WebsiteStatus =
  | 'DRAFTING'
  | 'PREVIEW_READY'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'ARCHIVED';
