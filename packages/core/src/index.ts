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

// Tool `sitebuilder_build_site` (T-053e; dipindah dari apps/api pada T-030tg agar api &
// worker sama-sama bisa merakit agent loop).
export {
  createSitebuilderBuildSiteTool,
  deriveSlug,
  parseBriefInput,
} from './agent/build-site-tool.js';

export {
  executeFunctionToolCalls,
  type ToolCallResultMessage,
} from './agent/function-call-bridge.js';

export {
  AGENT_MAX_STEPS_REPLY,
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_AGENT_MAX_TOKENS,
  runAgentLoop,
  type AgentLoopDeps,
  type AgentLoopRequest,
  type AgentLoopResult,
} from './agent/agent-loop.js';

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
export {
  AGENT_SYSTEM_PROMPTS,
  composeAgentPlan,
  createAgentReplier,
  type AgentPlan,
  type AgentReplierDeps,
  type ConversationReplier,
  type ConversationReplierError,
  type ConversationReplierRequest,
} from './conversation/replier.js';

// Self-serve onboarding + kuota (langkah #6 roadmap).
export {
  registerFromInvite,
  parseInviteCode,
  needsCodeReply,
  invalidCodeReply,
  registeredReply,
  type RegisterDeps,
  type RegisterOutcome,
  type RegisterRequest,
} from './onboarding/register-tenant.js';

// Aksi tombol interaktif kanal (T-031tg, FR-CHN-002).
export {
  encodeChannelAction,
  parseChannelAction,
  ACTION_PUBLISH_PREFIX,
  ACTION_REVISE_PREFIX,
  type ChannelAction,
} from './conversation/channel-actions.js';

// Publish request (T-063, BRU-02; dipindah dari apps/api pada T-031tg karena tombol
// "Setuju & publish" di worker memakai use case yang sama dengan rute HTTP).
export {
  handlePublishRequest,
  type PublishOutcome,
  type PublishRequest,
  type PublishRequestDeps,
} from './publish/handle-publish.js';

// Media dari chat → storage (T-033, FR-MED-001/002).
export {
  ingestMedia,
  type IngestMediaDeps,
  type IngestMediaRequest,
  type IngestMediaResult,
} from './media/ingest-media.js';

// Laporan biaya AI (T-082).
export {
  buildUsageReport,
  type DailyCost,
  type TenantCost,
  type UsageReport,
  type UsageReportDeps,
} from './llm/usage-report.js';

// Notifikasi hasil publish ke chat (T-032tg) — dipakai worker publish.
export {
  failedPublishMessage,
  livePublishMessage,
  notifyPublishOutcome,
  type NotifyDeps,
  type NotifyRequest,
  type NotifyResult,
  type PublishOutcomeNotice,
} from './conversation/notify-publish.js';

// Pesan masuk kanal eksternal (T-030tg, FR-CHN-001/004/005) — dipakai worker.
export {
  approvalButtons,
  handleInboundMessage,
  inboundFallbackReply,
  mediaFailedReply,
  mediaQuotaReply,
  mediaReceivedReply,
  quotaExhaustedReply,
  rateLimitedReply,
  unsupportedTypeReply,
  type ApprovalDeps,
  type InboundDeps,
  type InboundLogger,
  type MediaDeps,
  type InboundRequest,
  type InboundResult,
} from './conversation/handle-inbound.js';

// Builder use case (T-053b, FR-AGT-001/002).
export {
  buildSiteFromBrief,
  DEFAULT_BUILD_SYSTEM_PROMPT,
  type BuildDeps,
  type BuildError,
  type BuildRequest,
  type BuildResult,
  type InterviewBrief,
} from './builder/build-site.js';
