// T-053c: OpenAI-compatible agent adapter (DeepSeek/GLM) untuk LlmAgentPort.
// Mendukung function-calling (tools): respons bisa berupa teks final atau tool_calls.
// Reuse pola retry/backoff dari openai-compatible-json-adapter. fetch di-inject → offline-testable.

import {
  DEFAULT_TOKEN_PRICE,
  err,
  estimateCostUsd,
  ok,
  type LlmAgentPort,
  type LlmAgentRequest,
  type LlmAgentResponse,
  type LlmError,
  type LlmTokenPrice,
  type LlmUsageLoggerPort,
  type OpenAiFunctionToolCall,
  type OpenAiToolDefinition,
  type Result,
} from '@digimaestro/shared';
import type { RuntimeFetch, RuntimeResponse } from '../llm/openai-compatible-json-adapter.js';
import { containsToolMarkup, stripToolMarkup } from './sanitize-tool-markup.js';

export interface OpenAiCompatibleAgentAdapterConfig {
  readonly provider: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: RuntimeFetch;
  readonly usageLogger?: LlmUsageLoggerPort;
  readonly price?: LlmTokenPrice;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly retryInitialDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 300;
const DEFAULT_RETRY_MAX_DELAY_MS = 4_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// T-082: harga token TIDAK boleh ditebak kode (berubah & beda per model; salah menebak =
// laporan biaya yang menyesatkan). Datang dari config/env; 0 = belum dikonfigurasi.

export class OpenAiCompatibleAgentAdapter implements LlmAgentPort {
  readonly name: string;
  private readonly provider: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: RuntimeFetch;
  private readonly usageLogger?: LlmUsageLoggerPort;
  private readonly price: LlmTokenPrice;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: OpenAiCompatibleAgentAdapterConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.fetchFn = config.fetch ?? (globalThis.fetch as unknown as RuntimeFetch);
    this.usageLogger = config.usageLogger;
    this.price = config.price ?? DEFAULT_TOKEN_PRICE;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryInitialDelayMs = config.retryInitialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.sleep = config.sleep ?? defaultSleep;
    this.name = `llm-agent:${config.provider}`;
  }

  async completeWithTools(request: LlmAgentRequest): Promise<Result<LlmAgentResponse, LlmError>> {
    const body = this.buildRequestBody(request);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const result = await this.callApi(body, request, attempt);
      if (result.ok) return result;

      if (!result.error.retryable || attempt >= this.maxAttempts) return result;

      const delay = Math.min(
        this.retryInitialDelayMs * 2 ** (attempt - 1),
        this.retryMaxDelayMs,
      );
      await this.sleep(delay);
    }

    return err({ code: 'UNKNOWN', message: 'exhausted retries', retryable: false, attempt: this.maxAttempts });
  }

  private buildRequestBody(request: LlmAgentRequest): Record<string, unknown> {
    const messages = [
      { role: 'system', content: request.system },
      ...request.messages.map((m) => this.mapMessage(m)),
    ];
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.4,
    };
    if (request.tools.length > 0) {
      body.tools = request.tools as readonly OpenAiToolDefinition[];
    }
    return body;
  }

  private mapMessage(m: LlmAgentRequest['messages'][number]): Record<string, unknown> {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.name) msg.name = m.name;
    if (m.toolCalls) msg.tool_calls = m.toolCalls;
    return msg;
  }

  private async callApi(
    body: Record<string, unknown>,
    request: LlmAgentRequest,
    attempt: number,
  ): Promise<Result<LlmAgentResponse, LlmError>> {
    const controller = this.timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutId = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    try {
      const response: RuntimeResponse = await this.fetchFn(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller?.signal,
        },
      );

      if (!response.ok) {
        return err(this.httpError(response.status, response.statusText ?? '', attempt));
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const choice = data.choices?.[0];
      if (!choice) {
        return err({ code: 'PROVIDER', message: 'no choices in response', retryable: false, attempt });
      }

      // Log usage bila tersedia.
      if (data.usage && this.usageLogger) {
        void this.usageLogger.recordUsage({
          tenantId: request.tenantId,
          jobId: request.jobId,
          task: request.task,
          provider: this.provider,
          model: this.model,
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
          latencyMs: 0,
          estimatedCostUsd: estimateCostUsd(
            data.usage.prompt_tokens ?? 0,
            data.usage.completion_tokens ?? 0,
            this.price,
          ),
          createdAt: new Date().toISOString(),
        });
      }

      // Parse: tool_calls atau text.
      if (choice.message?.tool_calls?.length) {
        const toolCalls: OpenAiFunctionToolCall[] = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        return ok({ kind: 'tool_calls', toolCalls });
      }

      // T-053h: model kadang MENULIS pemanggilan tool sebagai teks (markup DSML DeepSeek,
      // blok <tool_call>, atau kalimat "Memanggil nama_tool(...)") alih-alih memakai
      // protokol tool_calls — terjadi saat tools dimatikan tapi prompt masih menyuruhnya.
      // Markup vendor BERHENTI di adapter; jangan pernah bocor ke pengguna.
      const raw = choice.message?.content ?? '';

      // Model kadang membalas content kosong/null (mis. ia "ingin" memanggil tool tapi
      // tools sedang dimatikan). Mengirim teks kosong = pesan GAGAL: Telegram menolak
      // sendMessage tanpa isi, dan pengguna tak menerima apa-apa. Perlakukan sebagai
      // balasan tak sah agar pemanggil memakai fallback yang sopan.
      if (raw.trim().length === 0) {
        // Model REASONING (deepseek-v4-pro dsb) menghabiskan anggaran token untuk berpikir
        // lebih dulu. Bila habis sebelum sempat menulis, `content` kosong & finish_reason
        // 'length'. Sebutkan itu terang-terangan — "teks kosong" saja menyesatkan dan
        // memakan waktu lama untuk didiagnosis.
        const truncated = choice.finish_reason === 'length';
        return err({
          code: 'PROVIDER',
          message: truncated
            ? 'anggaran token habis untuk reasoning — tak tersisa untuk jawaban (naikkan maxTokens)'
            : 'model membalas teks kosong',
          retryable: false,
          attempt,
        });
      }

      if (!containsToolMarkup(raw)) return ok({ kind: 'text', content: raw });

      const cleaned = stripToolMarkup(raw);
      if (cleaned.length > 0) return ok({ kind: 'text', content: cleaned });

      // Seluruh balasan hanya markup → tak ada yang layak dikirim. Kembalikan error agar
      // pemanggil memakai fallback yang sopan, bukan mengirim pesan kosong.
      return err({
        code: 'PROVIDER',
        message: 'model membalas markup tool-call sebagai teks (tak ada isi untuk pengguna)',
        retryable: false,
        attempt,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return err({ code: 'TIMEOUT', message: `timeout ${this.timeoutMs}ms`, retryable: true, attempt });
      }
      return err({ code: 'HTTP', message: e instanceof Error ? e.message : String(e), retryable: false, attempt });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private httpError(status: number, statusText: string, attempt: number): LlmError {
    const retryable = status === 429 || status >= 500;
    const code = retryable ? 'HTTP' : 'PROVIDER';
    return { code, message: `HTTP ${status} ${statusText}`.trim(), retryable, attempt };
  }
}

// Factory utk DeepSeek.
export function createDeepSeekAgentAdapter(config: Omit<OpenAiCompatibleAgentAdapterConfig, 'provider' | 'baseUrl'> & { readonly baseUrl?: string }) {
  return new OpenAiCompatibleAgentAdapter({
    ...config,
    provider: 'deepseek',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com/v1',
  });
}

// Factory utk GLM.
export function createGlmAgentAdapter(config: Omit<OpenAiCompatibleAgentAdapterConfig, 'provider' | 'baseUrl'> & { readonly baseUrl?: string }) {
  return new OpenAiCompatibleAgentAdapter({
    ...config,
    provider: 'glm',
    baseUrl: config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
  });
}

// Response shape dari OpenAI-compatible /chat/completions.
interface ChatCompletionResponse {
  readonly choices?: readonly [{
    // 'length' = anggaran token habis sebelum model selesai (pada model reasoning: habis
    // saat berpikir, sehingga `content` kosong).
    readonly finish_reason?: string;
    readonly message?: {
      readonly role: string;
      readonly content?: string | null;
      readonly tool_calls?: readonly [{
        readonly id: string;
        readonly type: 'function';
        readonly function: { readonly name: string; readonly arguments: string };
      }];
    };
  }];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}
