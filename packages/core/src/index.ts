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
  executeFunctionToolCalls,
  type OpenAiFunctionToolCall,
  type ToolCallResultMessage,
} from './agent/function-call-bridge.js';

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

export {
  runLlmEvaluation,
  summarizeLlmEvaluationRun,
  type LlmEvaluationFailure,
  type LlmEvaluationProviderFactory,
  type LlmEvaluationRun,
  type LlmEvaluationRunOptions,
} from './llm/evaluation-runner.js';

// Conversation orchestrator (T-052, FR-CNV-001/002).
export {
  classifyIntent,
  classifyIntentKeyword,
  INTENTS,
  type ClassifyIntentRequest,
  type ClassifierError,
  type Intent,
  type IntentClassifierDeps,
} from './conversation/intent.js';
export {
  advanceState,
  type RouterAction,
  type StateTransition,
} from './conversation/state-machine.js';
export {
  advanceConversation,
  type AdvanceConversationRequest,
  type ConversationAdvance,
  type ConversationRouterDeps,
} from './conversation/router.js';
