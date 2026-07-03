// T-051: bridge function-calling provider-compatible ke AgentToolRegistry.
// Tetap murni dan offline-testable; MCP SDK/transport nyata menyusul di adapter/app.

import type { AgentToolContext, AgentToolRegistry } from '@digimaestro/shared';

export interface OpenAiFunctionToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface ToolCallResultMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
}

export async function executeFunctionToolCalls(
  registry: AgentToolRegistry,
  calls: readonly OpenAiFunctionToolCall[],
  context: AgentToolContext,
): Promise<readonly ToolCallResultMessage[]> {
  const results: ToolCallResultMessage[] = [];
  for (const call of calls) {
    results.push(await executeFunctionToolCall(registry, call, context));
  }
  return results;
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
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
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
