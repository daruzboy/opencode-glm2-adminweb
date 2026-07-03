// T-051: tool pertama untuk registry agent.
// Tool ini bergantung pada port kecil, bukan Prisma/MCP/provider.

import { err, ok } from '@digimaestro/shared';
import type {
  AgentToolDefinition,
  AgentToolError,
  Result,
  TenantId,
} from '@digimaestro/shared';

export interface SiteOutline {
  readonly websiteId: string;
  readonly title: string;
  readonly pages: readonly {
    readonly slug: string;
    readonly title: string;
    readonly sections: readonly string[];
  }[];
}

export interface RevisionPatchResult {
  readonly revisionId: string;
  readonly summary: string;
}

export interface AgentJobStatusView {
  readonly jobId: string;
  readonly status: 'QUEUED' | 'RUNNING' | 'NEEDS_INFO' | 'DONE' | 'FAILED';
  readonly kind: 'BUILD' | 'EDIT' | 'ARTICLE' | 'CATALOG' | 'DOMAIN';
  readonly attempts: number;
  readonly error?: string;
}

export interface SitebuilderToolPort {
  getSiteOutline(tenantId: TenantId, input: { readonly websiteId?: string }): Promise<Result<SiteOutline | null, AgentToolError>>;
  applyPatch(
    tenantId: TenantId,
    input: { readonly websiteId: string; readonly instruction: string },
  ): Promise<Result<RevisionPatchResult, AgentToolError>>;
}

export interface OpsToolPort {
  getJobStatus(tenantId: TenantId, input: { readonly jobId: string }): Promise<Result<AgentJobStatusView | null, AgentToolError>>;
}

export function createSitebuilderGetSiteOutlineTool(
  port: Pick<SitebuilderToolPort, 'getSiteOutline'>,
): AgentToolDefinition<unknown, SiteOutline> {
  return {
    name: 'sitebuilder_get_site_outline',
    description: 'Ambil outline Site Document tenant untuk konteks agent.',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: { type: 'string', description: 'Opsional. ID website tenant.' },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const parsed = parseOptionalWebsiteIdInput(input);
      if (!parsed.ok) return parsed;
      const result = await port.getSiteOutline(context.tenantId, parsed.value);
      if (!result.ok) return result;
      if (!result.value) return err({ code: 'NOT_FOUND', message: 'outline situs tidak ditemukan' });
      return ok(result.value);
    },
  };
}

export function createSitebuilderApplyPatchTool(
  port: Pick<SitebuilderToolPort, 'applyPatch'>,
): AgentToolDefinition<unknown, RevisionPatchResult> {
  return {
    name: 'sitebuilder_apply_patch',
    description: 'Terapkan instruksi revisi terstruktur pada Site Document tenant.',
    scope: 'sitebuilder',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: { type: 'string' },
        instruction: { type: 'string' },
      },
      required: ['websiteId', 'instruction'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const parsed = parsePatchInput(input);
      if (!parsed.ok) return parsed;
      return port.applyPatch(context.tenantId, parsed.value);
    },
  };
}

export function createOpsGetJobStatusTool(
  port: Pick<OpsToolPort, 'getJobStatus'>,
): AgentToolDefinition<unknown, AgentJobStatusView> {
  return {
    name: 'ops_get_job_status',
    description: 'Ambil status AgentJob tenant untuk monitoring agent.',
    scope: 'ops',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const parsed = parseJobInput(input);
      if (!parsed.ok) return parsed;
      const result = await port.getJobStatus(context.tenantId, parsed.value);
      if (!result.ok) return result;
      if (!result.value) return err({ code: 'NOT_FOUND', message: 'job tidak ditemukan' });
      return ok(result.value);
    },
  };
}

function parseOptionalWebsiteIdInput(input: unknown): Result<{ readonly websiteId?: string }, AgentToolError> {
  if (!isRecord(input)) return err({ code: 'INVALID_INPUT', message: 'input harus object' });
  const websiteId = input.websiteId;
  if (websiteId === undefined) return { ok: true, value: {} };
  if (typeof websiteId !== 'string' || websiteId.length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'websiteId harus string' });
  }
  return { ok: true, value: { websiteId } };
}

function parsePatchInput(input: unknown): Result<{ readonly websiteId: string; readonly instruction: string }, AgentToolError> {
  if (!isRecord(input)) return err({ code: 'INVALID_INPUT', message: 'input harus object' });
  if (typeof input.websiteId !== 'string' || input.websiteId.length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'websiteId wajib string' });
  }
  if (typeof input.instruction !== 'string' || input.instruction.trim().length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'instruction wajib string' });
  }
  return { ok: true, value: { websiteId: input.websiteId, instruction: input.instruction.trim() } };
}

function parseJobInput(input: unknown): Result<{ readonly jobId: string }, AgentToolError> {
  if (!isRecord(input)) return err({ code: 'INVALID_INPUT', message: 'input harus object' });
  if (typeof input.jobId !== 'string' || input.jobId.length === 0) {
    return err({ code: 'INVALID_INPUT', message: 'jobId wajib string' });
  }
  return { ok: true, value: { jobId: input.jobId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
