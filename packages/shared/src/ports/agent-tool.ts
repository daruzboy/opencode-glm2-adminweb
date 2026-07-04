// Port: definisi tool agent yang netral vendor (SRS §5.4, FR-AGT-010).
// MCP server/bridge provider konkret boleh mengadaptasi kontrak ini di apps/adapters.

import type { Port, Result, TenantId } from '../index.js';

export type AgentToolScope = 'sitebuilder' | 'ops' | 'media' | 'content' | 'seo';

export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AgentToolContext {
  readonly tenantId: TenantId;
  readonly actor: string;
  readonly scopes: readonly AgentToolScope[];
}

export interface AgentToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly scope: AgentToolScope;
  readonly inputSchema: JsonSchemaObject;
  execute(input: TInput, context: AgentToolContext): Promise<Result<TOutput, AgentToolError>>;
}

export type AgentToolErrorCode = 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'UNKNOWN';

export interface AgentToolError {
  readonly code: AgentToolErrorCode;
  readonly message: string;
}

export interface AgentToolRegistry extends Port {
  listTools(context: AgentToolContext): readonly AgentToolDefinition<unknown, unknown>[];
  callTool(
    name: string,
    input: unknown,
    context: AgentToolContext,
  ): Promise<Result<unknown, AgentToolError>>;
}

export interface OpenAiToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchemaObject;
  };
}

// Tool call yang dikeluarkan provider OpenAI-compatible (function-calling). Dipakai
// Port LlmAgentPort (keluaran) maupun bridge eksekusi tool di core (T-051/T-053).
export interface OpenAiFunctionToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export function toOpenAiToolDefinition(
  tool: Pick<AgentToolDefinition<unknown, unknown>, 'name' | 'description' | 'inputSchema'>,
): OpenAiToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
