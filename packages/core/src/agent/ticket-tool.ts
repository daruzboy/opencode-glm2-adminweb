// Tool agent `create_ticket` (PO 2026-07-15): bot MENGKLASIFIKASIKAN permintaan
// pelanggan per topik dan memasukkannya ke daftar tiket dashboard — setiap kali
// pelanggan meminta pekerjaan/perubahan atau melaporkan masalah. Topik `gangguan`
// otomatis berprioritas tinggi + alert (best-effort) agar tak menunggu dashboard dibuka.

import { err, ok, TICKET_TOPICS } from '@digimaestro/shared';
import type {
  AgentToolDefinition,
  AlertPort,
  TicketRepository,
  TicketTopic,
} from '@digimaestro/shared';

export interface CreateTicketResult {
  readonly ticketId: string;
  readonly topic: string;
}

export function createTicketTool(
  tickets: TicketRepository,
  alert?: AlertPort,
): AgentToolDefinition<unknown, CreateTicketResult> {
  return {
    name: 'create_ticket',
    description:
      'Buat TIKET pekerjaan untuk tim saat pelanggan meminta perubahan/pekerjaan pada situsnya ' +
      'atau melaporkan masalah. Klasifikasikan topiknya: konten (teks, artikel, gambar, banner, ' +
      'isi web) · tampilan (desain, warna, layout, menu, halaman) · ganti-tema (minta tema/template ' +
      'baru) · fitur (formulir, tombol WA, integrasi, fungsi baru) · akun (billing, hak akses) · ' +
      'gangguan (error, website lambat, fitur tidak berjalan) · teknis (domain, migrasi, email, ' +
      'keamanan, backup). Set priority "tinggi" bila mendesak (situs mati/error, pelanggan sangat ' +
      'terdampak). JANGAN buat tiket untuk obrolan biasa atau pertanyaan yang langsung kamu jawab; ' +
      'jangan duplikat tiket untuk permintaan yang sama dalam satu percakapan. Setelah membuat ' +
      'tiket, tetap balas pelanggan (konfirmasi permintaannya dicatat).',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: [...TICKET_TOPICS], description: 'Topik tiket' },
        subject: { type: 'string', description: 'Ringkasan permintaan (1 kalimat)' },
        detail: { type: 'string', description: 'Detail tambahan (opsional, kata-kata pelanggan)' },
        priority: { type: 'string', enum: ['normal', 'tinggi'], description: 'Default normal' },
      },
      required: ['topic', 'subject'],
    },
    async execute(input, context) {
      const raw = (input ?? {}) as { topic?: unknown; subject?: unknown; detail?: unknown; priority?: unknown };
      const topic = (TICKET_TOPICS as readonly string[]).includes(String(raw.topic))
        ? (raw.topic as TicketTopic)
        : null;
      const subject =
        typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim().slice(0, 200) : null;
      if (!topic || !subject) {
        return err({ code: 'INVALID_INPUT', message: `topic (${TICKET_TOPICS.join('|')}) dan subject wajib` });
      }
      const detail = typeof raw.detail === 'string' && raw.detail.trim() ? raw.detail.trim().slice(0, 1000) : undefined;
      // Gangguan = layanan pelanggan terganggu SEKARANG → selalu prioritas tinggi.
      const priority = topic === 'gangguan' || raw.priority === 'tinggi' ? 'tinggi' : 'normal';

      const created = await tickets.create(context.tenantId, {
        subject,
        ...(detail ? { body: detail } : {}),
        topic,
        priority,
      });
      if (!created.ok) return err({ code: 'UNKNOWN', message: created.error.message });

      if (priority === 'tinggi' && alert) {
        await alert
          .notify({
            key: `ticket-tinggi:${context.tenantId}:${topic}`,
            severity: 'warn',
            title: `Tiket prioritas: ${topic}`,
            detail: subject,
            context: { tenantId: String(context.tenantId) },
          })
          .catch(() => undefined);
      }
      return ok({ ticketId: created.value.id, topic });
    },
  };
}
