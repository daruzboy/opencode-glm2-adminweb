// create_ticket: bot mengklasifikasikan permintaan pelanggan per topik → daftar tiket;
// gangguan otomatis prioritas tinggi + alert (best-effort).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import type { AlertPort, TicketRepository } from '@digimaestro/shared';
import { createTicketTool } from './ticket-tool.js';

const CTX = { tenantId: tenantId('t1'), actor: 'chatbot', scopes: ['sitebuilder'] } as const;

function repo(fail = false): TicketRepository & { create: ReturnType<typeof vi.fn> } {
  return {
    name: 'TicketRepository',
    create: vi.fn(async (_t, input) =>
      fail
        ? err({ code: 'UNKNOWN' as const, message: 'db' })
        : ok({
            id: 'tk1', tenantId: 't1', body: null, status: 'OPEN', createdAt: '',
            topic: input.topic ?? null, priority: input.priority ?? 'normal', subject: input.subject,
          }),
    ),
  } as never;
}

describe('create_ticket', () => {
  it('topik valid → tercatat; gangguan → prioritas tinggi + alert; konten normal → tanpa alert', async () => {
    const alert: AlertPort = { notify: vi.fn(async () => undefined) } as never;
    const r = repo();
    const tool = createTicketTool(r, alert);

    const g = await tool.execute({ topic: 'gangguan', subject: 'situs error 500' }, CTX);
    expect(g.ok).toBe(true);
    expect(r.create).toHaveBeenCalledWith(CTX.tenantId, expect.objectContaining({ topic: 'gangguan', priority: 'tinggi' }));
    expect(alert.notify).toHaveBeenCalledTimes(1);

    const k = await tool.execute({ topic: 'konten', subject: 'ganti banner promo', detail: 'foto lama' }, CTX);
    expect(k.ok).toBe(true);
    expect(r.create).toHaveBeenLastCalledWith(
      CTX.tenantId,
      expect.objectContaining({ topic: 'konten', priority: 'normal', body: 'foto lama' }),
    );
    expect(alert.notify).toHaveBeenCalledTimes(1);
  });

  it('topik tak dikenal / subject kosong → INVALID_INPUT; repo gagal → error', async () => {
    const tool = createTicketTool(repo());
    const bad = await tool.execute({ topic: 'lainnya', subject: 'x' }, CTX);
    expect(!bad.ok && bad.error.code).toBe('INVALID_INPUT');
    const noSubj = await tool.execute({ topic: 'fitur', subject: '  ' }, CTX);
    expect(noSubj.ok).toBe(false);

    const failing = createTicketTool(repo(true));
    expect((await failing.execute({ topic: 'fitur', subject: 'tombol WA' }, CTX)).ok).toBe(false);
  });
});
