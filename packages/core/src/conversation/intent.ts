// T-052: klasifikasi intent pesan (FR-CNV-002). Hybrid dua tahap (SRS §5.3
// "cache klasifikasi intent frasa umum" → hemat token):
//   1) classifyIntentKeyword() — murni, deterministik, gratis: frasa umum dipetakan
//      ke intent tanpa LLM. Menang mayoritas pesan singkat/klise.
//   2) classifyIntent() — bila keyword null & LlmJsonPort disuntik, klasifikasi via
//      LLM (task 'intent', temperature 0). Gagal LLM → Result.err (caller menentukan).
//      Tanpa LLM, keyword null → default 'other' agar tetap menghasilkan intent.
// Domain murni: tidak ada I/O selain LlmJsonPort (Port di shared) → diuji dengan fake.

import { err, ok } from '@digimaestro/shared';
import type {
  LlmJsonSchema,
  LlmJsonPort,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { defaultTemperatureForTask } from '@digimaestro/shared';

// ── Intent (dirancang ekstensible: tambah label di sini + rules di bawah) ──────
export type Intent = 'interview' | 'revision' | 'status' | 'other';

export const INTENTS: readonly Intent[] = Object.freeze([
  'interview',
  'revision',
  'status',
  'other',
]);

function isIntent(value: unknown): value is Intent {
  return (INTENTS as readonly string[]).includes(value as string);
}

// ── Error ─────────────────────────────────────────────────────────────────────

export type ClassifierErrorCode = 'LLM' | 'UNKNOWN';

export interface ClassifierError {
  readonly code: ClassifierErrorCode;
  readonly message: string;
}

// ── Normalisasi teks ──────────────────────────────────────────────────────────
// Lowercase + trim + collapse whitespace. Punctuation dipertahankan sebagai
// pemisah agar frasa tak menempel (mis. "revisi." tetap cocok "revisi").
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Aturan keyword (data, bukan kode) ─────────────────────────────────────────
// Urutan = prioritas. Frasa revision/status lebih spesifik diceok sebelum
// interview agar tidak salah tangkap (mis. "ganti" menang atas "baru").
interface KeywordRule {
  readonly intent: Intent;
  readonly patterns: readonly string[];
}

const KEYWORD_RULES: readonly KeywordRule[] = Object.freeze([
  {
    intent: 'revision',
    patterns: [
      'revisi',
      'ganti',
      'ubah',
      'rubah',
      'edit',
      'tambah',
      'hapus',
      'kurangi',
      'gantiin',
      'tukar',
      'update',
      'perbarui',
    ],
  },
  {
    intent: 'status',
    patterns: [
      'sampai mana',
      'progres',
      'kapan selesai',
      'kapan jadi',
      'udah jadi',
      'sudah jadi',
      'belum selesai',
      'berapa lama',
      'status',
      'kabar',
      'cek job',
      'cek status',
      'cek progres',
      'gimana proses',
    ],
  },
  {
    intent: 'interview',
    patterns: [
      'mau buat',
      'ingin buat',
      'pengen buat',
      'buat website',
      'buat web',
      'buat situs',
      'bikin situs',
      'bikin web',
      'bikin website',
      'bangun',
      'wawancara',
      'nama usaha',
      'mulai',
      'daftar',
      'daftarin',
      'punya web',
      'punya website',
      'isi data',
      'bantu buat',
      'butuh website',
      'butuh web',
    ],
  },
]);

// Klasifikasi murni berbasis frasa. Mengembalikan null bila tak ada kecocokan →
// sinyal bahwa LLM (opsional) perlu dipanggil. Murni & deterministik → mudah diuji.
export function classifyIntentKeyword(text: string): Intent | null {
  const n = normalize(text);
  if (n.length === 0) return null;
  for (const rule of KEYWORD_RULES) {
    for (const p of rule.patterns) {
      if (n.includes(p)) return rule.intent;
    }
  }
  return null;
}

// ── Schema keluaran LLM (struktural, kompatibel Zod tanpa import runtime) ─────
const intentLlmSchema: LlmJsonSchema<{ intent: Intent }> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null) {
      return { success: false, error: { message: 'Output LLM bukan objek.' } };
    }
    const candidate = (value as { intent?: unknown }).intent;
    if (isIntent(candidate)) {
      return { success: true, data: { intent: candidate } };
    }
    return {
      success: false,
      error: { message: `Intent tidak valid: ${String(candidate)}` },
    };
  },
};

export interface IntentClassifierDeps {
  readonly llm?: LlmJsonPort;
}

export interface ClassifyIntentRequest {
  readonly tenantId: TenantId;
  readonly text: string;
  readonly jobId?: string;
}

// Hybrid: keyword dulu; bila null & ada LLM → LLM; bila null & tanpa LLM → 'other'.
// Mengembalikan Result agar caller (router) dapat membedakan kegagalan LLM dari
// klasifikasi sukses (keyword/LLM/'other').
export async function classifyIntent(
  deps: IntentClassifierDeps,
  req: ClassifyIntentRequest,
): Promise<Result<Intent, ClassifierError>> {
  const hit = classifyIntentKeyword(req.text);
  if (hit !== null) return ok(hit);

  if (deps.llm === undefined) return ok('other');

  const r = await deps.llm.completeJson({
    tenantId: req.tenantId,
    jobId: req.jobId,
    task: 'intent',
    temperature: defaultTemperatureForTask('intent'),
    system:
      'Kamu adalah klasifier intent pesan UMKM Indonesia. Pilih SATU label: ' +
      '"interview" (mau buat/melanjutkan wawancara situs), "revision" (meminta ' +
      'perubahan situs), "status" (menanyakan progres), atau "other" (lainnya). ' +
      'Jawab HANYA JSON { "intent": "<label>" }.',
    messages: [{ role: 'user', content: req.text }],
    schema: intentLlmSchema,
    maxTokens: 32,
  });
  if (!r.ok) {
    return err({ code: 'LLM', message: r.error.message });
  }
  return ok(r.value.intent);
}
