// T-050/T-051 foundation: registry tool murni dengan scope guard.
// Implementasi tool nyata menyusul per use case; registry ini tidak tahu MCP/vendor.

import { err } from '@digimaestro/shared';
import type {
  AuditLogPort,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolError,
  AgentToolRegistry,
  Result,
} from '@digimaestro/shared';

export class InMemoryAgentToolRegistry implements AgentToolRegistry {
  readonly name = 'AgentToolRegistry' as const;
  private readonly tools: ReadonlyMap<string, AgentToolDefinition<unknown, unknown>>;

  constructor(
    tools: readonly AgentToolDefinition<unknown, unknown>[],
    private readonly auditLog?: AuditLogPort,
  ) {
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
      const result = err<AgentToolError>({ code: 'NOT_FOUND', message: `tool tidak ditemukan: ${name}` });
      const audit = await this.auditToolCall(name, context, 'not_found');
      return audit.ok ? result : audit;
    }
    if (!context.scopes.includes(tool.scope)) {
      const result = err<AgentToolError>({ code: 'FORBIDDEN', message: `scope tidak diizinkan: ${tool.scope}` });
      const audit = await this.auditToolCall(name, context, 'forbidden', tool.scope);
      return audit.ok ? result : audit;
    }
    const result = await this.runTool(tool, input, context);
    const audit = await this.auditToolCall(name, context, result.ok ? 'ok' : 'error', tool.scope);
    return audit.ok ? result : audit;
  }

  // Isolasi exception tak terduga dari tool nyata (Prisma/HTTP): tanpa ini, satu tool yang
  // melempar akan me-reject Promise.all di function-call-bridge dan menjatuhkan seluruh batch.
  private async runTool(
    tool: AgentToolDefinition<unknown, unknown>,
    input: unknown,
    context: AgentToolContext,
  ): Promise<Result<unknown, AgentToolError>> {
    try {
      return await tool.execute(input, context);
    } catch (e) {
      return err<AgentToolError>({
        code: 'UNKNOWN',
        message: `tool gagal dieksekusi: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async auditToolCall(
    toolName: string,
    context: AgentToolContext,
    outcome: 'ok' | 'error' | 'forbidden' | 'not_found',
    scope?: AgentToolDefinition<unknown, unknown>['scope'],
  ): Promise<Result<void, AgentToolError>> {
    if (!this.auditLog) return { ok: true, value: undefined };
    const recorded = await this.auditLog.record({
      actor: context.actor,
      tenantId: context.tenantId,
      action: 'agent.tool.call',
      meta: { toolName, scope, outcome },
    });
    if (recorded.ok) return recorded;
    return err({ code: 'UNKNOWN', message: `gagal mencatat audit tool: ${recorded.error.message}` });
  }
}

export function createAgentToolRegistry(
  tools: readonly AgentToolDefinition<unknown, unknown>[],
  auditLog?: AuditLogPort,
): AgentToolRegistry {
  return new InMemoryAgentToolRegistry(tools, auditLog);
}
