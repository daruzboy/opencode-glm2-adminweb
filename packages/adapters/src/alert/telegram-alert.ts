// T-070: alert operasional → Telegram (chat ops PO). Kanal langsung, tanpa perantara.
//
// Kenapa tidak lewat n8n saja (ADR-7): alert yang bergantung pada sistem yang mungkin IKUT
// TUMBANG bukan alert. n8n adalah komponen tambahan yang bisa mati bersama VPS. Telegram
// Bot API hidup di luar infrastruktur kita → jalur alert tetap ada saat platform sekarat.
// Adapter webhook (n8n) tetap disediakan terpisah untuk integrasi sekunder.

import { err, ok } from '@digimaestro/shared';
import type { Alert, AlertError, AlertPort, ChannelPort, Result } from '@digimaestro/shared';

export interface TelegramAlertOptions {
  // Chat OPS (PO), bukan chat pelanggan.
  readonly opsChatId: string;
  readonly channel: ChannelPort;
  // Nama lingkungan agar alert dari staging tak disangka produksi.
  readonly environment?: string;
}

const ICON: Record<Alert['severity'], string> = {
  warn: '⚠️',
  error: '🔴',
  critical: '🚨',
};

export class TelegramAlert implements AlertPort {
  constructor(private readonly options: TelegramAlertOptions) {}

  async notify(alert: Alert): Promise<Result<void, AlertError>> {
    const sent = await this.options.channel.sendText(
      this.options.opsChatId,
      formatAlert(alert, this.options.environment),
    );
    if (!sent.ok) return err({ code: 'SEND', message: sent.error.message });
    return ok(undefined);
  }
}

// Alert harus bisa DITINDAK: apa yang rusak, di mana, dan konteks secukupnya untuk mulai
// menggali — bukan sekadar "error".
export function formatAlert(alert: Alert, environment?: string): string {
  const lines = [`${ICON[alert.severity]} ${alert.title}`];
  if (environment) lines.push(`env: ${environment}`);
  if (alert.detail) lines.push('', alert.detail);

  if (alert.context && Object.keys(alert.context).length > 0) {
    lines.push('');
    for (const [k, v] of Object.entries(alert.context)) lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}
