// T-050: evaluation runner — menjalankan golden prompt × provider untuk menghasilkan
// data (pass rate, kualitas, latensi, biaya) yang menjadi input recommendLlmProvider.
// Murni & offline-testable: provider adalah factory LlmJsonPort (test pakai DeterministicLlmJsonAdapter,
// produksi pakai adapter nyata). Begitu API key diisi, CLI di apps/worker memakai ini ke endpoint sungguhan.

import { ok, tenantId } from '@digimaestro/shared';
import type {
  LlmError,
  LlmJsonPort,
  LlmJsonRequest,
  LlmJsonSchema,
  LlmTask,
  LlmUsageLoggerPort,
  LlmUsageRecord,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { LLM_GOLDEN_PROMPTS, type LlmGoldenPrompt } from './golden-prompts.js';
import {
  createLlmEvaluationReport,
  type LlmEvaluationReport,
  type LlmPromptEvaluation,
  type LlmProviderEvaluationWeights,
} from './provider-evaluation.js';

export interface LlmEvaluationProviderFactory {
  readonly name: string;
  createPort(logger: LlmUsageLoggerPort): LlmJsonPort;
}

export interface LlmEvaluationFailure {
  readonly promptId: string;
  readonly provider: string;
  readonly error: string;
}

export interface LlmEvaluationRun {
  readonly evaluations: readonly LlmPromptEvaluation[];
  readonly failures: readonly LlmEvaluationFailure[];
}

export interface LlmEvaluationRunOptions {
  readonly prompts?: readonly LlmGoldenPrompt[];
  readonly tenantId?: TenantId;
  readonly task?: LlmTask;
  readonly signal?: AbortSignal;
  // Ambang cakupan sinyal (0..1) agar sebuah output dianggap lulus. Default 0.6:
  // cukup 1 sinyal saja terlalu longgar untuk memilih provider default produksi.
  readonly passThreshold?: number;
}

export const DEFAULT_PASS_THRESHOLD = 0.6;

interface EvalPlanOutput {
  readonly summary: string;
  readonly sections: readonly string[];
  readonly needsInfo: boolean;
}

const EVAL_SYSTEM_PROMPT =
  'Kamu adalah perencana situs digimaestro.id untuk UMKM Indonesia. ' +
  'Dari brief klien, susun rencana situs yang konkret, ramah SEO, dan kontekstual dengan usahanya. ' +
  'Jika brief terlalu samar untuk membuat rencana, tandai needsInfo=true dan sebutkan pertanyaan lanjutan di summary. ' +
  'Balas HANYA JSON dengan bentuk: {"summary": string, "sections": string[], "needsInfo": boolean}.';

const EVAL_SCHEMA: LlmJsonSchema<EvalPlanOutput> = {
  safeParse(value) {
    if (!isRecord(value)) return fail('output harus object');
    if (typeof value.summary !== 'string' || value.summary.length === 0) return fail('summary harus string tidak kosong');
    if (!Array.isArray(value.sections) || !value.sections.every((section) => typeof section === 'string')) {
      return fail('sections harus array string');
    }
    if (typeof value.needsInfo !== 'boolean') return fail('needsInfo harus boolean');
    return { success: true, data: { summary: value.summary, sections: value.sections, needsInfo: value.needsInfo } };
  },
};

export async function runLlmEvaluation(
  providers: readonly LlmEvaluationProviderFactory[],
  options: LlmEvaluationRunOptions = {},
): Promise<LlmEvaluationRun> {
  const prompts = options.prompts ?? LLM_GOLDEN_PROMPTS;
  const tid = options.tenantId ?? tenantId('eval');
  const task = options.task ?? 'site_plan';
  const passThreshold = options.passThreshold ?? DEFAULT_PASS_THRESHOLD;

  const evaluations: LlmPromptEvaluation[] = [];
  const failures: LlmEvaluationFailure[] = [];

  for (const provider of providers) {
    const capture = createCapturingUsageLogger();
    const port = provider.createPort(capture.logger);
    for (const prompt of prompts) {
      if (options.signal?.aborted) break;
      const startedAt = Date.now();
      const result = await port.completeJson(buildRequest(prompt, tid, task));
      const latencyMs = Date.now() - startedAt;

      if (!result.ok) {
        failures.push({ promptId: prompt.id, provider: provider.name, error: result.error.message });
        continue;
      }

      const qualityScore = scoreSignalCoverage(prompt, result.value);
      const usage = capture.last();
      evaluations.push({
        promptId: prompt.id,
        provider: provider.name,
        passed: qualityScore >= passThreshold,
        qualityScore,
        latencyMs,
        estimatedCostUsd: usage?.estimatedCostUsd ?? 0,
      });
    }
  }

  return { evaluations, failures };
}

export function summarizeLlmEvaluationRun(
  run: LlmEvaluationRun,
  prompts: readonly LlmGoldenPrompt[] = LLM_GOLDEN_PROMPTS,
  weights?: LlmProviderEvaluationWeights,
): LlmEvaluationReport {
  return createLlmEvaluationReport(
    prompts.map((prompt) => prompt.id),
    run.evaluations,
    weights,
  );
}

function buildRequest(prompt: LlmGoldenPrompt, tid: TenantId, task: LlmTask): LlmJsonRequest<EvalPlanOutput> {
  return {
    tenantId: tid,
    task,
    system: EVAL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt.prompt }],
    schema: EVAL_SCHEMA,
    maxTokens: 800,
  };
}

// Skor kualitas berbasis cakupan sinyal wajib (requiredSignals) di output. Heuristik kasar
// namun obyektif & reproducible; grading semantik penuh bisa ditambah kemudian tanpa ubah kontrak.
// Pencocokan pakai batas kata (bukan substring polos) supaya "menu" tak dianggap cocok di "menuju".
function scoreSignalCoverage(prompt: LlmGoldenPrompt, output: EvalPlanOutput): number {
  if (prompt.requiredSignals.length === 0) return 1;
  const haystack = `${output.summary} ${output.sections.join(' ')}`.toLowerCase();
  const hits = prompt.requiredSignals.filter((signal) => matchesSignal(haystack, signal)).length;
  return hits / prompt.requiredSignals.length;
}

// Cocok bila sinyal muncul sebagai kata/frasa utuh: batas kiri-kanan bukan huruf/angka.
// Sadar Unicode (flag `u`) agar aksara & digit non-ASCII tetap dihitung sebagai bagian kata.
function matchesSignal(haystack: string, signal: string): boolean {
  const needle = signal.toLowerCase().trim();
  if (needle.length === 0) return false;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, 'u');
  return pattern.test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createCapturingUsageLogger(): {
  readonly logger: LlmUsageLoggerPort;
  readonly last: () => LlmUsageRecord | undefined;
} {
  const records: LlmUsageRecord[] = [];
  return {
    logger: {
      name: 'llm-usage:capture',
      async recordUsage(record: LlmUsageRecord): Promise<Result<void, LlmError>> {
        records.push(record);
        return ok(undefined);
      },
    },
    last: () => records.at(-1),
  };
}

function fail(message: string): { readonly success: false; readonly error: { readonly message: string } } {
  return { success: false, error: { message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
