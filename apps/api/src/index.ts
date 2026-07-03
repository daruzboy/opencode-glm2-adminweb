// apps/api — Fastify v5 (webhook WABA/Xendit, REST tenant, WS web chat). SRS §9.
// Fastify & plugin dipasang saat EPIC-03 (Sprint 0.2). Untuk T-010 ini skeleton komposisi root.

export const APP_NAME = 'digimaestro-api';

export interface ServerHandle {
  readonly name: string;
  readonly ready: boolean;
}

// Composition root sementara — nantinya menyuntikkan adapter ke use case via DI container.
export function buildServer(name: string = APP_NAME): ServerHandle {
  return { name, ready: true };
}
