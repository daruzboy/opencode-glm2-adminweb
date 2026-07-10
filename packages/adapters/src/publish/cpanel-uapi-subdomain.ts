// Adapter: SubdomainPort via cPanel UAPI (T-063, FR-PUB-004b). Buat `<slug>.<rootDomain>`
// sebelum deploy (SubDomain::addsubdomain). Idempoten: subdomain sudah ada → ok(created:false).
// fetch DI-INJECT → offline-testable tanpa jaringan. Auth: cPanel API token (preferensi,
// header `Authorization: cpanel <user>:<token>`) ATAU Basic auth password (fallback host tanpa
// menu API token, header `Authorization: Basic base64(user:pass)`). Endpoint panel HTTPS (:2083).

import { Buffer } from 'node:buffer';
import { err, ok } from '@digimaestro/shared';
import type { PublishError, Result, SubdomainPort, SubdomainProvision, SubdomainResult } from '@digimaestro/shared';

export interface UapiFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type UapiFetch = (
  url: string,
  init: { readonly method: 'GET'; readonly headers: Record<string, string> },
) => Promise<UapiFetchResponse>;

export interface CpanelUapiConfig {
  readonly host: string; // hostname panel cPanel (mis. cikapundung.iixcp.rumahweb.net)
  readonly port?: number; // default 2083 (cPanel HTTPS)
  readonly username: string; // akun cPanel utama (pemilik domain)
  // Auth: isi salah satu — apiToken (preferensi) ATAU password (Basic auth fallback).
  readonly apiToken?: string; // cPanel API token (Security → Manage API Tokens)
  readonly password?: string; // password cPanel (fallback bila menu API token tak tersedia)
  readonly fetch?: UapiFetch;
}

// Header Authorization: token cPanel bila ada, else Basic auth password.
function authHeader(config: CpanelUapiConfig): string {
  if (config.apiToken) return `cpanel ${config.username}:${config.apiToken}`;
  if (config.password) return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  throw new Error('CpanelUapiConfig butuh apiToken atau password');
}

// Bentuk respons UAPI: { status: 0|1, errors: string[]|null, ... }.
interface UapiEnvelope {
  readonly status?: number;
  readonly errors?: readonly string[] | null;
}

function defaultFetch(): UapiFetch {
  const runtime = globalThis as { readonly fetch?: (input: string, init: unknown) => Promise<UapiFetchResponse> };
  if (!runtime.fetch) throw new Error('fetch global tidak tersedia; suntik UapiFetch pada CpanelUapiConfig');
  return (url, init) => runtime.fetch!(url, init);
}

export function createCpanelUapiSubdomain(config: CpanelUapiConfig): SubdomainPort {
  const fetchImpl = config.fetch ?? defaultFetch();
  const port = config.port ?? 2083;
  const authorization = authHeader(config); // validasi auth di konstruksi (fail-fast)

  return {
    async ensureSubdomain(input: SubdomainProvision): Promise<Result<SubdomainResult, PublishError>> {
      const fqdn = `${input.slug}.${input.rootDomain}`;
      const params = new URLSearchParams({
        domain: input.slug,
        rootdomain: input.rootDomain,
        dir: input.docroot,
      });
      const url = `https://${config.host}:${port}/execute/SubDomain/addsubdomain?${params.toString()}`;

      let res: UapiFetchResponse;
      try {
        res = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: authorization },
        });
      } catch (e) {
        return err({ code: 'SUBDOMAIN', message: `gagal memanggil UAPI addsubdomain: ${(e as Error).message}` });
      }

      const bodyText = await res.text();
      if (!res.ok) {
        return err({ code: 'SUBDOMAIN', message: `UAPI HTTP ${res.status}: ${bodyText.slice(0, 200)}` });
      }

      let body: UapiEnvelope;
      try {
        body = JSON.parse(bodyText) as UapiEnvelope;
      } catch {
        return err({ code: 'SUBDOMAIN', message: `respons UAPI bukan JSON: ${bodyText.slice(0, 200)}` });
      }

      if (body.status === 1) {
        return ok({ subdomain: fqdn, created: true });
      }

      // status 0 → cek apakah karena subdomain sudah ada (idempoten) vs error nyata.
      const errorText = (body.errors ?? []).join('; ');
      if (/already exists/i.test(errorText)) {
        return ok({ subdomain: fqdn, created: false });
      }
      return err({ code: 'SUBDOMAIN', message: `UAPI addsubdomain gagal: ${errorText || 'unknown'}` });
    },
  };
}
