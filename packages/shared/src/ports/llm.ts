// Port: LLM abstraction layer (SRS §5.1, FR-AGT-008).
// Implementasi vendor konkret hidup di packages/adapters agar dependency rule tetap bersih.

import type { Port, Result, TenantId } from '../index.js';

export type LlmTask = 'site_plan' | 'section_copy' | 'revision_patch' | 'article' | 'intent' | 'interview';

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
export const DEFAULT_TEMPERATURE_BY_TASK: Readonly<Record<LlmTask, number>> = Object.freeze({
  intent: 0,
  revision_patch: 0.1,
  site_plan: 0.3,
  interview: 0.4,
  section_copy: 0.5,
  article: 0.7,
});

export function defaultTemperatureForTask(task: LlmTask): number {
  return DEFAULT_TEMPERATURE_BY_TASK[task];
}
