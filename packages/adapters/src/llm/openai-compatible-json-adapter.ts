// OpenAI-compatible JSON adapter (DeepSeek/GLM) for T-050.
// No vendor SDK import here: runtime fetch is injected for tests and composition roots.

import {
  defaultTemperatureForTask,
  err,
  ok,
  type LlmChatMessage,
  type LlmError,
  type LlmJsonPort,
  type LlmJsonRequest,
  type LlmRuntimeOverrides,
  type LlmTokenPrice,
  type LlmUsageLoggerPort,
  type LlmUsageRecord,
  type Result,
} from '@digimaestro/shared';

export type OpenAiCompatibleProvider = 'deepseek' | 'glm';

export interface OpenAiCompatibleJsonAdapterConfig {
  readonly provider: OpenAiCompatibleProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: RuntimeFetch;
  readonly usageLogger?: LlmUsageLoggerPort;
  readonly price?: LlmTokenPrice;
  readonly maxAttempts?: number;
  readonly inputTokenCostPer1M?: number;
  readonly outputTokenCostPer1M?: number;
  // Batas waktu per panggilan HTTP (ms). <= 0 menonaktifkan timeout. Default 30 detik.
  readonly timeoutMs?: number;
  // Backoff eksponensial antar retry transport (429/5xx/timeout). Default 300ms → 4s cap.
  readonly retryInitialDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  // Injectable untuk test agar backoff tidak benar-benar menunggu. Default setTimeout.
  readonly sleep?: (ms: number) => Promise<void>;
  // Override runtime (dashboard admin): dibaca PER PANGGILAN — ganti model/API key/harga
  // tanpa restart. Nilai yang tak di-set jatuh ke konfigurasi konstruksi.
  readonly overrides?: () => LlmRuntimeOverrides;
}

export interface RuntimeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  json(): Promise<unknown>;
}

export type RuntimeFetch = (
  input: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<RuntimeResponse>;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 300;
const DEFAULT_RETRY_MAX_DELAY_MS = 4_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

interface ProviderCompletion {
  readonly content: string;
  readonly usage: ProviderUsage;
}

interface CompletionAttempt<T> {
  readonly result: Result<T, LlmError>;
  readonly repairHint?: LlmChatMessage;
}

export class OpenAiCompatibleJsonAdapter implements LlmJsonPort {
  readonly name: string;

  private readonly fetch: RuntimeFetch;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: OpenAiCompatibleJsonAdapterConfig) {
    this.name = `llm:${config.provider}`;
    this.fetch = config.fetch ?? browserFetch();
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 3);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryInitialDelayMs = config.retryInitialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.sleep = config.sleep ?? defaultSleep;
  }

  // Konfigurasi efektif SAAT INI (override runtime > konstruksi). Dievaluasi per panggilan.
  private effective(): { model: string; apiKey: string; inputPer1M: number; outputPer1M: number } {
    const o = this.config.overrides?.() ?? {};
    return {
      model: o.model || this.config.model,
      apiKey: o.apiKey || this.config.apiKey,
      inputPer1M:
        o.price?.inputPer1M ?? this.config.inputTokenCostPer1M ?? this.config.price?.inputPer1M ?? 0,
      outputPer1M:
        o.price?.outputPer1M ?? this.config.outputTokenCostPer1M ?? this.config.price?.outputPer1M ?? 0,
    };
  }

  async completeJson<T>(request: LlmJsonRequest<T>): Promise<Result<T, LlmError>> {
    if (this.effective().apiKey.length === 0) {
      return err(makeError('CONFIG', 'API key LLM belum dikonfigurasi', false, 0));
    }

    const repairHints: LlmChatMessage[] = [];
    let lastError: LlmError = makeError('UNKNOWN', 'LLM gagal menghasilkan JSON valid', true, 0);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const completion = await this.requestCompletion(request, repairHints, attempt);
      if (!completion.ok) {
        lastError = completion.error;
        if (!completion.error.retryable) return completion;
        await this.backoff(attempt);
        continue;
      }

      const parsed = await this.parseCompletion(request, completion.value, attempt);
      if (parsed.result.ok) return parsed.result;
      lastError = parsed.result.error;
      if (!parsed.result.error.retryable || !parsed.repairHint) return parsed.result;
      repairHints.push(parsed.repairHint);
    }

    return err({ ...lastError, retryable: false });
  }

  // Jeda eksponensial sebelum percobaan berikutnya (transport 429/5xx/timeout).
  // Tidak menunda setelah percobaan terakhir karena tak ada retry lagi sesudahnya.
  private async backoff(attempt: number): Promise<void> {
    if (attempt >= this.maxAttempts) return;
    const delay = Math.min(this.retryInitialDelayMs * 2 ** (attempt - 1), this.retryMaxDelayMs);
    if (delay > 0) await this.sleep(delay);
  }

  private async requestCompletion<T>(
    request: LlmJsonRequest<T>,
    repairHints: readonly LlmChatMessage[],
    attempt: number,
  ): Promise<Result<ProviderCompletion, LlmError>> {
    const startedAt = Date.now();
    const response = await this.fetchCompletion(request, repairHints, attempt);
    if (!response.ok) return response;

    const eff = this.effective();
    const usageRecord = toUsageRecord({
      request,
      usage: response.value.usage,
      latencyMs: Date.now() - startedAt,
      provider: this.config.provider,
      model: eff.model,
      // T-082: harga dari config (env/override runtime). Sebelumnya `?? 0` diam-diam membuat
      // SELURUH biaya tercatat $0.0000 meski ratusan ribu token terbakar.
      inputTokenCostPer1M: eff.inputPer1M,
      outputTokenCostPer1M: eff.outputPer1M,
    });

    const logged = await this.config.usageLogger?.recordUsage(usageRecord);
    if (logged && !logged.ok) {
      return err(makeError('USAGE_LOG', logged.error.message, true, attempt));
    }

    return response;
  }

  private async fetchCompletion<T>(
    request: LlmJsonRequest<T>,
    repairHints: readonly LlmChatMessage[],
    attempt: number,
  ): Promise<Result<ProviderCompletion, LlmError>> {
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    const eff = this.effective();
    try {
      const response = await this.fetch(`${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${eff.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: eff.model,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages,
            ...repairHints,
          ],
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? defaultTemperatureForTask(request.task),
          response_format: { type: 'json_object' },
        }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        return err(
          makeError('HTTP', `LLM HTTP ${response.status}`, isRetryableHttpStatus(response.status), attempt),
        );
      }

      const body = await response.json();
      const completion = parseProviderCompletion(body);
      if (!completion) {
        return err(makeError('PROVIDER', 'Respons LLM tidak sesuai kontrak', true, attempt));
      }
      return ok(completion);
    } catch (e) {
      if (controller?.signal.aborted) {
        return err(makeError('TIMEOUT', `LLM timeout setelah ${this.timeoutMs}ms`, true, attempt));
      }
      return err(makeError('UNKNOWN', errorMessage(e), true, attempt));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async parseCompletion<T>(
    request: LlmJsonRequest<T>,
    completion: ProviderCompletion,
    attempt: number,
  ): Promise<CompletionAttempt<T>> {
    const decoded = parseJson(completion.content);
    if (!decoded.ok) {
      return {
        result: err(makeError('INVALID_JSON', decoded.error, true, attempt)),
        repairHint: repairHint(`Output sebelumnya bukan JSON valid: ${decoded.error}`),
      };
    }

    const parsed = request.schema.safeParse(decoded.value);
    if (!parsed.success) {
      return {
        result: err(makeError('INVALID_SCHEMA', parsed.error.message, true, attempt)),
        repairHint: repairHint(`Output sebelumnya gagal validasi schema: ${parsed.error.message}`),
      };
    }

    return { result: ok(parsed.data) };
  }
}

export function createDeepSeekJsonAdapter(
  config: Omit<OpenAiCompatibleJsonAdapterConfig, 'provider' | 'baseUrl'> & {
    readonly baseUrl?: string;
  },
): OpenAiCompatibleJsonAdapter {
  return new OpenAiCompatibleJsonAdapter({
    ...config,
    provider: 'deepseek',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
  });
}

export function createGlmJsonAdapter(
  config: Omit<OpenAiCompatibleJsonAdapterConfig, 'provider' | 'baseUrl'> & {
    readonly baseUrl?: string;
  },
): OpenAiCompatibleJsonAdapter {
  return new OpenAiCompatibleJsonAdapter({
    ...config,
    provider: 'glm',
    baseUrl: config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
  });
}

function parseProviderCompletion(value: unknown): ProviderCompletion | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string') {
    return null;
  }
  return {
    content: first.message.content,
    usage: parseUsage(value.usage),
  };
}

function parseUsage(value: unknown): ProviderUsage {
  if (!isRecord(value)) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const promptTokens = numberOrZero(value.prompt_tokens);
  const completionTokens = numberOrZero(value.completion_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: numberOrZero(value.total_tokens) || promptTokens + completionTokens,
  };
}

function toUsageRecord(args: {
  readonly request: LlmJsonRequest<unknown>;
  readonly usage: ProviderUsage;
  readonly latencyMs: number;
  readonly provider: string;
  readonly model: string;
  readonly inputTokenCostPer1M: number;
  readonly outputTokenCostPer1M: number;
}): LlmUsageRecord {
  return {
    tenantId: args.request.tenantId,
    jobId: args.request.jobId,
    task: args.request.task,
    provider: args.provider,
    model: args.model,
    promptTokens: args.usage.promptTokens,
    completionTokens: args.usage.completionTokens,
    totalTokens: args.usage.totalTokens,
    latencyMs: args.latencyMs,
    estimatedCostUsd:
      (args.usage.promptTokens / 1_000_000) * args.inputTokenCostPer1M +
      (args.usage.completionTokens / 1_000_000) * args.outputTokenCostPer1M,
    createdAt: new Date().toISOString(),
  };
}

function repairHint(content: string): LlmChatMessage {
  return {
    role: 'user',
    content: `${content}\nBalas ulang hanya JSON yang sesuai schema.`,
  };
}

function parseJson(value: string): Result<unknown, string> {
  try {
    return ok(JSON.parse(value) as unknown);
  } catch (e) {
    return err(errorMessage(e));
  }
}

function makeError(
  code: LlmError['code'],
  message: string,
  retryable: boolean,
  attempt: number,
): LlmError {
  return { code, message, retryable, attempt };
}

// 5xx = server transient; 429 = rate limit; 408 = request timeout. Semuanya layak dicoba
// ulang (idealnya dengan backoff). Status 4xx lain (400/401/403) permanen → jangan retry.
function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function browserFetch(): RuntimeFetch {
  const runtime = globalThis as { readonly fetch?: RuntimeFetch };
  if (!runtime.fetch) throw new Error('fetch tidak tersedia');
  return runtime.fetch;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
