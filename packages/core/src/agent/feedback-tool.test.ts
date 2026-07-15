// record_feedback: bot mencatat keluhan/saran; keluhan memicu alert (best-effort).

import { describe, expect, it, vi } from 'vitest';
import { err, ok, tenantId } from '@digimaestro/shared';
import type { AlertPort, FeedbackRepository } from '@digimaestro/shared';
import { createRecordFeedbackTool } from './feedback-tool.js';

const CTX = { tenantId: tenantId('t1'), actor: 'chatbot', scopes: ['sitebuilder'] } as const;

function repo(fail = false): FeedbackRepository & { create: ReturnType<typeof vi.fn> } {
  return {
    name: 'FeedbackRepository',
    create: vi.fn(async (_t, input) =>
      fail
        ? err({ code: 'UNKNOWN' as const, message: 'db' })
        : ok({ id: 'f1', tenantId: 't1', resolvedAt: null, createdAt: '', ...input }),
    ),
  } as never;
}

describe('record_feedback', () => {
  it('keluhan → tercatat + alert warn; saran → tercatat TANPA alert', async () => {
    const alert: AlertPort = { notify: vi.fn(async () => undefined) } as never;
    const tool = createRecordFeedbackTool(repo(), alert);

    const r1 = await tool.execute({ kind: 'keluhan', text: 'fotonya kurang cocok' }, CTX);
    expect(r1.ok).toBe(true);
    expect(alert.notify).toHaveBeenCalledTimes(1);

    const r2 = await tool.execute({ kind: 'saran', text: 'tambah galeri video' }, CTX);
    expect(r2.ok).toBe(true);
    expect(alert.notify).toHaveBeenCalledTimes(1);
  });

  it('kind aneh / text kosong → INVALID_INPUT; repo gagal → error', async () => {
    const tool = createRecordFeedbackTool(repo());
    const bad = await tool.execute({ kind: 'curhat', text: 'x' }, CTX);
    expect(!bad.ok && bad.error.code).toBe('INVALID_INPUT');

    const failing = createRecordFeedbackTool(repo(true));
    const res = await failing.execute({ kind: 'saran', text: 'x' }, CTX);
    expect(res.ok).toBe(false);
  });
});
