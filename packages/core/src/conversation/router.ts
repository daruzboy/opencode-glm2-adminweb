// T-052: use case router — orkestrasi CNV (FR-CNV-001/002). Bergantung HANYA pada
// Port (shared): ConversationRepository (load+persist state) & LlmJsonPort? (fallback
// klasifikasi). Diuji dengan fake → tanpa DB/jaringan. Menyuntik tenantId ke SETIAP
// panggilan repo (NFR-09).

import { err, ok } from '@digimaestro/shared';
import type {
  ConversationRepository,
  ConversationState,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { classifyIntent, type Intent, type IntentClassifierDeps } from './intent.js';
import { advanceState, type RouterAction } from './state-machine.js';

export interface ConversationRouterDeps extends IntentClassifierDeps {
  readonly conversations: ConversationRepository;
}

export interface AdvanceConversationRequest {
  readonly tenantId: TenantId;
  readonly conversationId: string;
  readonly text: string;
  readonly jobId?: string;
}

export interface ConversationAdvance {
  readonly conversationId: string;
  readonly previousState: ConversationState;
  readonly intent: Intent;
  readonly state: ConversationState;
  readonly action: RouterAction;
  readonly changed: boolean;
}

// Alur: load percakapan (tenant-scoped) → klasifikasi intent → state machine →
// persist state bila berubah. Mengembalikan hasil lengkap agar handler/bot bisa
// menyusun balasan sesuai aksi (FR-CNV-002 routing).
export async function advanceConversation(
  deps: ConversationRouterDeps,
  req: AdvanceConversationRequest,
): Promise<Result<ConversationAdvance, RepositoryError | { code: 'NOT_FOUND' | 'LLM'; message: string }>> {
  const loaded = await deps.conversations.findById(req.tenantId, req.conversationId);
  if (!loaded.ok) return err(loaded.error);
  if (loaded.value === null) {
    return err({ code: 'NOT_FOUND', message: `Conversation ${req.conversationId} tidak ditemukan.` });
  }
  const previousState = loaded.value.state;

  const classified = await classifyIntent(deps, {
    tenantId: req.tenantId,
    text: req.text,
    jobId: req.jobId,
  });
  if (!classified.ok) {
    return err({ code: 'LLM', message: classified.error.message });
  }
  const intent = classified.value;

  const transition = advanceState(previousState, intent);
  const changed = transition.state !== previousState;

  if (changed) {
    const updated = await deps.conversations.update(req.tenantId, req.conversationId, {
      state: transition.state,
    });
    if (!updated.ok) return err(updated.error);
  }

  return ok({
    conversationId: req.conversationId,
    previousState,
    intent,
    state: transition.state,
    action: transition.action,
    changed,
  });
}
