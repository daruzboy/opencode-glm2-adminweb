// Port: handoff review PO ke editor-web (P5).
//
// Keputusan PO 2026-07-14 (dua gerbang): situs hasil AI dengan TEMPLATE BARU untuk tenant
// itu direview/dirapikan PO di editor visual dulu, baru pelanggan menerima preview +
// tombol approval (pelanggan tetap pemegang keputusan akhir). Perubahan isi pada template
// yang sama LEWAT langsung — review manusia hanya di tempat yang nilainya nyata.
//
// Aturan sumber kebenaran: editor-web otoritatif SELAMA review; saat PO menekan
// "Kirim ke pelanggan", dokumen EDITAN dikirim balik dan dibekukan sebagai Revision glm2
// (snapshot immutable) — publish hanya pernah membaca Revision glm2.

import type { Result } from '../index.js';

export interface HandoffInput {
  // Nama proyek di editor (konvensi: "AI · <namaUsaha> (<tenantSlug>)").
  readonly name: string;
  // Nama pelanggan/usaha — editor memakainya utk label tombol "Kirim ke \"X\"".
  readonly customerName?: string;
  readonly templateId: string;
  // MobiriseProject (bentuk BERSAMA — tanpa konversi).
  readonly document: unknown;
  // Korelasi balik: dikirim ulang oleh editor-web saat "Kirim ke pelanggan" dan
  // diverifikasi glm2 (panggilan palsu tak bisa memajukan situs orang lain).
  readonly source: {
    readonly websiteId: string;
    readonly revisionId: string;
    readonly returnUrl: string;
  };
}

export type HandoffError =
  | { readonly code: 'HTTP'; readonly message: string }
  | { readonly code: 'AUTH'; readonly message: string }
  | { readonly code: 'UNKNOWN'; readonly message: string };

export interface EditorHandoffPort {
  createProject(
    input: HandoffInput,
  ): Promise<Result<{ projectId: string; editorUrl: string }, HandoffError>>;
}
