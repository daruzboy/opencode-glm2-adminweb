// packages/core — domain & application (use cases).
// Dependency rule: TIDAK boleh import adapters/SDK vendor. Hanya boleh import @digimaestro/shared.
// Modul konkret (conversation, agent, builder, publishing, billing, dll.) ditambahkan per backlog (SRS §4.1).

export { ok, err, type Result, type DomainEvent, domainEvent, type TenantId, tenantId } from '@digimaestro/shared';

// Status website state machine (FRD §6.1) — domain murni, tanpa I/O.
export type WebsiteStatus =
  | 'DRAFTING'
  | 'PREVIEW_READY'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'ARCHIVED';

export {
  createOpsGetJobStatusTool,
  createSitebuilderApplyPatchTool,
  createSitebuilderGetSiteOutlineTool,
  type AgentJobStatusView,
  type OpsToolPort,
  type RevisionPatchResult,
  type SiteOutline,
  type SitebuilderToolPort,
} from './agent/builtin-tools.js';

export {
  InMemoryAgentToolRegistry,
  createAgentToolRegistry,
} from './agent/tool-registry.js';

export {
  LLM_GOLDEN_PROMPTS,
  getLlmGoldenPrompt,
  type LlmGoldenPrompt,
} from './llm/golden-prompts.js';

export {
  createLlmEvaluationReport,
  recommendLlmProvider,
  type LlmEvaluationReport,
  type LlmPromptEvaluation,
  type LlmProviderEvaluationWeights,
  type LlmProviderRecommendation,
  type LlmProviderScore,
} from './llm/provider-evaluation.js';
