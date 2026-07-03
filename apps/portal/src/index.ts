// apps/portal — React 19 + Vite 6 (portal klien + dashboard admin). PRD §4.1, SRS §2.
// Vite/React/Tailwind/shadcn dipasang saat EPIC-04 (web chat) & EPIC-08 (admin). Untuk T-010 skeleton.

export const PORTAL_NAME = 'digimaestro-portal';

export interface PortalConfig {
  readonly name: string;
  readonly locale: 'id' | 'en';
}

export function createPortal(name: string = PORTAL_NAME): PortalConfig {
  return { name, locale: 'id' };
}
