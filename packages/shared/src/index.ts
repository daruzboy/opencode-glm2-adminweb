// packages/shared — kernel & ports (clean architecture: domain/application bergantung ke sini).
// Dipakai oleh core & adapters. Lihat SRS §4.1 (shared/kernel, shared/ports).

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: string;
}

export function domainEvent(type: string, occurredAt: string = new Date().toISOString()): DomainEvent {
  return { type, occurredAt };
}

// Marker untuk Port (interface I/O eksternal). Implementasi konkret ada di packages/adapters.
export interface Port {
  readonly name: string;
}

// TenantId — branding type (kernel). Mencegah tertukar dgn string biasa; dipakai
// Port repository (arg wajib) maupun use case. Dulu di core, kini di kernel agar
// shared/ports bisa memakainya tanpa import core (dependency rule: core → shared).
export type TenantId = string & { readonly __tenant: unique symbol };

export function tenantId(value: string): TenantId {
  return value as TenantId;
}

// Port layer — repository (SRS §4.1 shared/ports, §9.1).
export * from './ports/agent-tool.js';
export * from './ports/alert.js';
export * from './ports/audit-log.js';
export * from './ports/channel.js';
export * from './ports/auth.js';
export * from './ports/llm.js';
export * from './ports/llm-usage-query.js';
export * from './ports/media.js';
export * from './ports/onboarding.js';
export * from './ports/llm-agent.js';
export * from './ports/preview.js';
export * from './ports/publish.js';
export * from './ports/publish-queue.js';
export * from './ports/publish-source.js';
export * from './ports/repository.js';
export * from './ports/template.js';
export * from './ports/editor-handoff.js';
