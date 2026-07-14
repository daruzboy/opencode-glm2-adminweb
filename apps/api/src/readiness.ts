// P1: /readyz — kesiapan NYATA (DB + Redis), bukan sekadar "proses hidup".
//
// /healthz lama hanya menjawab "proses jalan" — kontainer bisa "sehat" sementara DB/Redis
// tak terjangkau dan tiap request gagal (persis pola insiden worker-stub: hijau di luar,
// mati di dalam). Healthcheck compose diarahkan ke /readyz agar Docker me-restart/menahan
// trafik saat dependensi putus.
//
// Tiap probe diberi deadline 2 dtk (withDeadline): probe yang menggantung = unready, bukan
// healthcheck yang ikut menggantung.

import { withDeadline } from '@digimaestro/adapters';
import type { FastifyInstance } from 'fastify';

export interface ReadinessDeps {
  // Lempar error bila tak siap; selesai normal bila siap.
  readonly db?: () => Promise<void>;
  readonly redis?: () => Promise<void>;
  readonly deadlineMs?: number;
}

const PROBE_DEADLINE_MS = 2_000;

type ProbeState = 'ok' | 'skipped' | `gagal: ${string}`;

async function probe(
  check: (() => Promise<void>) | undefined,
  ms: number,
  label: string,
): Promise<ProbeState> {
  if (!check) return 'skipped'; // dependensi tak dikonfigurasi ≠ tak siap
  try {
    await withDeadline(check(), ms, label);
    return 'ok';
  } catch (e) {
    return `gagal: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function registerReadiness(app: FastifyInstance, deps: ReadinessDeps = {}): void {
  app.get('/readyz', async (_req, reply) => {
    const ms = deps.deadlineMs ?? PROBE_DEADLINE_MS;
    const [db, redis] = await Promise.all([
      probe(deps.db, ms, 'readyz db'),
      probe(deps.redis, ms, 'readyz redis'),
    ]);

    const ready = !db.startsWith('gagal') && !redis.startsWith('gagal');
    const body = { status: ready ? 'ready' : 'unready', db, redis };
    if (!ready) return reply.code(503).send(body);
    return body;
  });
}
