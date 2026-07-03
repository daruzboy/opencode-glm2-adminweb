// T-050/T-051 foundation: registry tool murni dengan scope guard.
// Implementasi tool nyata menyusul per use case; registry ini tidak tahu MCP/vendor.

import { err } from '@digimaestro/shared';
import type {
  AgentToolContext,
  AgentToolDefinition,
  AgentToolError,
  AgentToolRegistry,
  Result,
} from '@digimaestro/shared';

export class InMemoryAgentToolRegistry implements AgentToolRegistry {
  readonly name = 'AgentToolRegistry' as const;
  private readonly tools: ReadonlyMap<string, AgentToolDefinition<unknown, unknown>>;

  constructor(tools: readonly AgentToolDefinition<unknown, unknown>[]) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  listTools(context: AgentToolContext): readonly AgentToolDefinition<unknown, unknown>[] {
    return Array.from(this.tools.values()).filter((tool) => context.scopes.includes(tool.scope));
  }

  async callTool(
    name: string,
    input: unknown,
    context: AgentToolContext,
  ): Promise<Result<unknown, AgentToolError>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return err({ code: 'NOT_FOUND', message: `tool tidak ditemukan: ${name}` });
    }
    if (!context.scopes.includes(tool.scope)) {
      return err({ code: 'FORBIDDEN', message: `scope tidak diizinkan: ${tool.scope}` });
    }
    return tool.execute(input, context);
  }
}

export function createAgentToolRegistry(
  tools: readonly AgentToolDefinition<unknown, unknown>[],
): AgentToolRegistry {
  return new InMemoryAgentToolRegistry(tools);
}
