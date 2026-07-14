// Port: LLM abstraction layer (SRS §5.1, FR-AGT-008).
// Implementasi vendor konkret hidup di packages/adapters agar dependency rule tetap bersih.

import type { Port, Result, TenantId } from '../index.js';

export type LlmTask =
  | 'site_plan'
  | 'section_copy'
  | 'revision_patch'
  | 'article'
  | 'intent'
  | 'interview'
  // P4 (engine template Mobirise): pilih template dari shortlist; isi nilai slot per halaman.
  | 'template_pick'
  | 'slot_fill';

export type LlmChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmChatMessage {
  readonly role: LlmChatRole;
  readonly content: string;
}

export type LlmJsonSchemaResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly message: string } };

// Structural subset dari ZodType.safeParse agar caller tetap bisa mengirim schema Zod
// tanpa shared mengimpor package runtime `zod`.
export interface LlmJsonSchema<T> {
  safeParse(value: unknown): LlmJsonSchemaResult<T>;
}

export interface LlmJsonRequest<T> {
  readonly tenantId: TenantId;
  readonly jobId?: string;
  readonly task: LlmTask;
  readonly system: string;
  readonly messages: readonly LlmChatMessage[];
  readonly schema: LlmJsonSchema<T>;
  readonly maxTokens: number;
  readonly temperature?: number;
}

export type LlmErrorCode =
  | 'CONFIG'
  | 'HTTP'
  | 'TIMEOUT'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'PROVIDER'
  | 'USAGE_LOG'
  | 'UNKNOWN';

export interface LlmError {
  readonly code: LlmErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly attempt: number;
}

export interface LlmUsageRecord {
  readonly tenantId: TenantId;
  readonly jobId?: string;
  readonly task: LlmTask;
  readonly provider: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
  readonly createdAt: string;
}

export interface LlmUsageLoggerPort extends Port {
  recordUsage(record: LlmUsageRecord): Promise<Result<void, LlmError>>;
}

export interface LlmJsonPort extends Port {
  completeJson<T>(request: LlmJsonRequest<T>): Promise<Result<T, LlmError>>;
}

// Default temperature per task (T-050). Task kreatif (article/copy) butuh divergensi
// tinggi; task presisi (intent/revision_patch) butuh determinisme rendah. Caller tetap
// dapat override via LlmJsonRequest.temperature.
// Model default DeepSeek (ADR-4). `deepseek-v4-pro` dipilih ketimbang `-flash`: tugas
// berat kita (menyusun Site Document JSON yang harus lolos schema ketat) menuntut penalaran
// lebih kuat, dan alias lama `deepseek-chat` tak lagi menyebut varian secara eksplisit.
// Override per lingkungan lewat env DEEPSEEK_MODEL.
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';

// Timeout panggilan LLM. 30 dtk cukup untuk balasan chat, TAPI TIDAK untuk membangun situs:
// model harus menyusun Site Document JSON penuh (banyak halaman & section) yang wajib lolos
// schema — di uji nyata v4-pro konsisten kena timeout dan build selalu gagal. Tugas berat
// diberi jendela jauh lebih lebar; kanal chat tak terpengaruh karena pekerjaan ini berjalan
// di worker (bukan di webhook yang harus balas cepat).
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
export const BUILD_LLM_TIMEOUT_MS = 180_000;

export const DEFAULT_TEMPERATURE_BY_TASK: Readonly<Record<LlmTask, number>> = Object.freeze({
  intent: 0,
  template_pick: 0, // keputusan kategoris — determinisme penuh
  revision_patch: 0.1,
  site_plan: 0.3,
  interview: 0.4,
  slot_fill: 0.4, // copywriting pendek — sedikit divergensi, tetap patuh slot
  section_copy: 0.5,
  article: 0.7,
});

export function defaultTemperatureForTask(task: LlmTask): number {
  return DEFAULT_TEMPERATURE_BY_TASK[task];
}

// ── Harga token (T-082) ───────────────────────────────────────────────────────
//
// SATU sumber kebenaran harga. Sebelumnya harga tercecer & SALAH:
//   - JSON adapter memakai `inputTokenCostPer1M ?? 0` → composition tak pernah mengisinya
//     → `cost` yang tercatat SELALU 0 (terbukti di produksi: 123k token, biaya $0.0000).
//   - Agent adapter memakai konstanta hardcoded (0.14/0.28) — harga model lama.
//
// Harga BUKAN sesuatu yang boleh ditebak kode: ia berubah, berbeda per model, dan salah
// menebaknya = laporan biaya yang menyesatkan (lebih buruk daripada tak ada laporan).
// Karena itu harga datang dari ENV, dan `LlmUsage.tokenIn/tokenOut` (fakta terukur) yang
// jadi dasar hitung — bukan kolom `cost` historis.
export interface LlmTokenPrice {
  // USD per 1 JUTA token.
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

// Default = 0 (SENGAJA). Nol memaksa biaya tampil sebagai "belum dikonfigurasi" alih-alih
// diam-diam melaporkan angka karangan yang dikira benar oleh PO.
export const DEFAULT_TOKEN_PRICE: LlmTokenPrice = { inputPer1M: 0, outputPer1M: 0 };

export function parseTokenPrice(
  input: string | undefined,
  output: string | undefined,
): LlmTokenPrice {
  const num = (v: string | undefined): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return { inputPer1M: num(input), outputPer1M: num(output) };
}

export function estimateCostUsd(
  tokenIn: number,
  tokenOut: number,
  price: LlmTokenPrice,
): number {
  return (tokenIn / 1_000_000) * price.inputPer1M + (tokenOut / 1_000_000) * price.outputPer1M;
}

export function isPriceConfigured(price: LlmTokenPrice): boolean {
  return price.inputPer1M > 0 || price.outputPer1M > 0;
}
