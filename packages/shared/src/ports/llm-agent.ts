// Port: LLM tool-augmented chat (agent loop, SRS §5.2; FR-AGT-008/010).
// Berbeda dari LlmJsonPort (JSON satu-tembakan): port ini iteratif — bisa membalas
// teks final ATAU sekumpulan tool_calls yang harus dieksekusi pemanggil (agent loop
// di core) lalu dikembalikan ke port untuk langkah berikutnya. Implementasi vendor
// konkret (OpenAI-compatible function-calling, MCP host) hidup di packages/adapters.

import type { Port, Result, TenantId } from '../index.js';
import type { LlmChatMessage, LlmError, LlmTask } from './llm.js';
import type { OpenAiFunctionToolCall, OpenAiToolDefinition } from './agent-tool.js';

// Pesan agent loop. Assistant yang memicu tool membawa `toolCalls`; pesan role 'tool'
// (hasil eksekusi) membawa `toolCallId`+`name` agar provider mencocokkan ke call asal.
export interface LlmAgentChatMessage extends LlmChatMessage {
  readonly toolCallId?: string;
  readonly name?: string;
  readonly toolCalls?: readonly OpenAiFunctionToolCall[];
}

export interface LlmAgentRequest {
  readonly tenantId: TenantId;
  readonly jobId?: string;
  readonly task: LlmTask;
  readonly system: string;
  readonly messages: readonly LlmAgentChatMessage[];
  readonly tools: readonly OpenAiToolDefinition[];
  readonly maxTokens: number;
  readonly temperature?: number;
}

// Keluaran port: teks final (akhir loop) atau tool_calls (lanjut loop).
export type LlmAgentResponse =
  | { readonly kind: 'text'; readonly content: string }
  | { readonly kind: 'tool_calls'; readonly toolCalls: readonly OpenAiFunctionToolCall[] };

export interface LlmAgentPort extends Port {
  completeWithTools(request: LlmAgentRequest): Promise<Result<LlmAgentResponse, LlmError>>;
}
