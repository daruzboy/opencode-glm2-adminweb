// Redaksi kredensial di log akses (audit 2026-07-16).
//
// Token JWT WebSocket dikirim lewat query (?token=...) karena browser tak bisa menyetel
// header Authorization saat membuka WS (NFR-07). Redaksi pino hanya menjangkau PATH OBJEK
// (mis. req.headers.authorization) — ia tak bisa menyunting substring di dalam req.url,
// jadi tanpa serializer ini setiap koneksi WS menulis token utuh ke log.
//
// `t` ikut diredaksi: token preview draft (/api/preview/:id?t=...) juga kapabilitas akses,
// walau kelasnya lebih rendah (rotasi PREVIEW_TOKEN_SECRET mencabut semuanya).

const SENSITIVE_QUERY_PARAMS = ['token', 't'] as const;

export function redactUrlQuery(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const name of SENSITIVE_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, '[REDACTED]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

// Bentuk minimal request yang dibaca serializer — cukup properti yang dipakai, agar
// teruji tanpa Fastify.
export interface SerializableRequest {
  readonly method?: string;
  readonly url?: string;
  readonly hostname?: string;
  readonly ip?: string;
  readonly socket?: { readonly remotePort?: number };
}

// Pengganti serializer `req` bawaan pino/Fastify: field yang sama (method, url, hostname,
// remoteAddress, remotePort), hanya url-nya melewati redaksi query di atas.
export function redactedRequestSerializer(req: SerializableRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: req.url === undefined ? undefined : redactUrlQuery(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
