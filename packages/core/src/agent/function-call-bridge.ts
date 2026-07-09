// T-051: bridge function-calling provider-compatible ke AgentToolRegistry.
// Tetap murni dan offline-testable; MCP SDK/transport nyata menyusul di adapter/app.

import type { AgentToolContext, AgentToolRegistry, OpenAiFunctionToolCall } from '@digimaestro/shared';

export interface ToolCallResultMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
}

// Tool dieksekusi paralel (function-calling provider mengeluarkan banyak call sekaligus).
// Promise.all mempertahankan urutan hasil = urutan input, sehingga toolCallId tetap cocok.
export async function executeFunctionToolCalls(
  registry: AgentToolRegistry,
  calls: readonly OpenAiFunctionToolCall[],
  context: AgentToolContext,
): Promise<readonly ToolCallResultMessage[]> {
  return Promise.all(calls.map((call) => executeFunctionToolCall(registry, call, context)));
}

async function executeFunctionToolCall(
  registry: AgentToolRegistry,
  call: OpenAiFunctionToolCall,
  context: AgentToolContext,
): Promise<ToolCallResultMessage> {
  const input = parseToolArguments(call.function.arguments);
  const result = input.ok
    ? await registry.callTool(call.function.name, input.value, context)
    : input;

  return {
    role: 'tool',
    toolCallId: call.id,
    name: call.function.name,
    content: JSON.stringify(result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }),
  };
}

function parseToolArguments(value: string):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: 'INVALID_INPUT'; readonly message: string } } {
  // Provider function-calling kerap mengirim arguments "" untuk call tanpa argumen;
  // untuk tool ber-input semua-opsional, itu sah dan setara dengan objek kosong.
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
