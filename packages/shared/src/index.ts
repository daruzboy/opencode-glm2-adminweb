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
