// Port: katalog template Mobirise (P3) — dasar alur "AI pilih template, lalu isi slotnya".
//
// Kenapa kontrak slot, bukan "LLM tulis HTML": blok Mobirise adalah HTML+LESS bebas; LLM
// yang menulis markup mentah akan merusak struktur/positioning template. LLM hanya mengisi
// NILAI slot bernama (teks/gambar/tautan) yang diekstrak dari blok — pola yang sama dengan
// siteDraftSchema lama (LLM diarahkan skema, kode yang merakit) dan terbukti bisa divalidasi.
//
// Kenapa shortlist: ratusan template tak mungkin dimuat ke prompt. Filter deterministik
// (businessTypes/tags) memangkas ke belasan ringkasan; baru LLM memilih satu.

import type { Result } from '../index.js';

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly businessTypes: readonly string[];
  readonly tags: readonly string[];
  // Ringkasan isi (dari indexer) — bahan pertimbangan pemilihan.
  readonly pageCount: number;
  readonly textSlots: number;
  readonly imageSlots: number;
}

export type TemplateSlotKind = 'text' | 'image' | 'link';

export interface TemplateSlot {
  // Identitas slot di dalam blok (data-edit-id hasil annotateEditable engine).
  readonly editId: string;
  // Indeks blok di halaman — bersama pageSlug + editId = alamat slot yang lengkap.
  readonly blockIndex: number;
  readonly kind: TemplateSlotKind;
  // Petunjuk untuk LLM: nama blok + kelas elemen (mis. "header2 · mbr-section-title").
  readonly hint: string;
  // Isi bawaan template — contoh gaya/panjang yang diharapkan; juga fallback `keep`.
  readonly current: string;
}

export interface TemplatePageContract {
  readonly slug: string;
  readonly title: string;
  readonly slots: readonly TemplateSlot[];
}

export interface TemplateContract {
  readonly templateId: string;
  readonly pages: readonly TemplatePageContract[];
}

// Nilai isian slot. `keep` eksplisit: slot yang tak diisi mempertahankan isi template —
// pengisian parsial menghasilkan situs utuh, bukan situs bolong.
export type SlotFill =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly url: string; readonly alt: string }
  | { readonly kind: 'link'; readonly href: string; readonly label?: string }
  | { readonly kind: 'keep' };

export interface PageFills {
  readonly slug: string;
  // Judul halaman boleh ikut diganti (tab browser + SEO).
  readonly title?: string;
  // editId → isian.
  readonly fills: Readonly<Record<string, SlotFill>>;
}

export type TemplateError =
  | { readonly code: 'NOT_FOUND'; readonly message: string }
  | { readonly code: 'INVALID'; readonly message: string }
  | { readonly code: 'UNKNOWN'; readonly message: string };

export interface ShortlistCriteria {
  // Jenis usaha dari brief interview (mis. "rental mobil", "warung sate").
  readonly businessType: string;
  readonly limit?: number;
}

export interface TemplateCatalogPort {
  shortlist(criteria: ShortlistCriteria): Promise<Result<readonly TemplateSummary[], TemplateError>>;
  getContract(templateId: string): Promise<Result<TemplateContract, TemplateError>>;
  // Terapkan isian ke template → dokumen MobiriseProject (bentuk bersama editor-web),
  // siap disimpan sebagai Revision.siteDoc (renderEngine 'mobirise-v1').
  materialize(
    templateId: string,
    pages: readonly PageFills[],
  ): Promise<Result<unknown, TemplateError>>;
}
