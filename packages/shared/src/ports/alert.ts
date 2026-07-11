// Port: alert operasional (T-070; ADR-7). Memberi tahu PO saat sesuatu rusak — SEBELUM
// pelanggan yang memberi tahu.
//
// Masalah yang ditutup: kegagalan selama ini HANYA masuk log. Bot bisa mati, job publish
// bisa dead-letter, backup bisa gagal — dan tak seorang pun tahu sampai ada yang kebetulan
// membaca stdout container. Untuk produk yang dijual, itu tidak memadai.
//
// ADR-7 menyebut n8n sebagai kanal notifikasi. Port ini menghormatinya (adapter webhook →
// n8n), TAPI juga menyediakan adapter Telegram langsung: satu komponen lebih sedikit yang
// bisa ikut mati. Alert yang bergantung pada sistem yang mungkin ikut tumbang bukan alert.

import type { Result } from '../index.js';

export type AlertSeverity = 'warn' | 'error' | 'critical';

export interface Alert {
  // Kunci dedup. Kegagalan berulang dgn key sama diredam (lihat cooldown) — kalau LLM
  // tumbang, 100 pesan gagal TIDAK boleh jadi 100 notifikasi.
  readonly key: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly detail?: string;
  // Konteks yang membuat alert bisa ditindak (tenant, job, slug) — bukan sekadar "error".
  readonly context?: Readonly<Record<string, string | number>>;
}

export interface AlertError {
  readonly code: 'SEND' | 'CONFIG';
  readonly message: string;
}

export interface AlertPort {
  notify(alert: Alert): Promise<Result<void, AlertError>>;
}
