// Tool agent `record_feedback` (dashboard admin, PO 2026-07-15): bot MENCATAT keluhan/saran
// pelanggan begitu disampaikan di chat — masuk dashboard PO; keluhan juga memicu alert
// (best-effort) supaya tak menunggu PO membuka dashboard.

import { err, ok } from '@digimaestro/shared';
import type { AgentToolDefinition, AlertPort, FeedbackRepository } from '@digimaestro/shared';

export interface RecordFeedbackResult {
  readonly recorded: true;
}

export function createRecordFeedbackTool(
  feedback: FeedbackRepository,
  alert?: AlertPort,
): AgentToolDefinition<unknown, RecordFeedbackResult> {
  return {
    name: 'record_feedback',
    description:
      'Catat KELUHAN atau SARAN pelanggan ke sistem (ditinjau tim). Panggil saat pelanggan ' +
      'mengeluh tentang layanan/hasil, atau memberi usul perbaikan. Setelah mencatat, tetap ' +
      'tanggapi pelanggan dengan empati — tool ini hanya pencatatan, bukan jawaban.',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['keluhan', 'saran'], description: 'Jenis masukan' },
        text: { type: 'string', description: 'Ringkasan masukan (1-3 kalimat, kata-kata pelanggan)' },
      },
      required: ['kind', 'text'],
    },
    async execute(input, context) {
      const raw = (input ?? {}) as { kind?: unknown; text?: unknown };
      const kind = raw.kind === 'keluhan' || raw.kind === 'saran' ? raw.kind : null;
      const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim().slice(0, 500) : null;
      if (!kind || !text) {
        return err({ code: 'INVALID_INPUT', message: 'kind (keluhan|saran) dan text wajib' });
      }

      const created = await feedback.create(context.tenantId, { kind, text });
      if (!created.ok) return err({ code: 'UNKNOWN', message: created.error.message });

      if (kind === 'keluhan' && alert) {
        await alert
          .notify({
            key: `feedback-keluhan:${context.tenantId}`,
            severity: 'warn',
            title: 'Keluhan pelanggan baru',
            detail: text,
            context: { tenantId: String(context.tenantId) },
          })
          .catch(() => undefined);
      }
      return ok({ recorded: true });
    },
  };
}
