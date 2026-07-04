import { randomUUID } from 'node:crypto';
import type {
  ConversationRepository,
  MessageEntity,
  MessageRepository,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { err, ok } from '@digimaestro/shared';
import type { ConversationReplier } from '@digimaestro/core';

// Use case web chat (T-040). Bergantung hanya pada Port (shared/core) → diuji dengan fake.
// Menyuntik tenantId ke SETIAP panggilan repo (NFR-09). Kanal web & WA berbagi
// Conversation/Message yang sama → riwayat terpadu per tenant (FR-CHN-003).
//
// T-053: deps.reply opsional (agent loop nyata). Bila tidak disuntik / gagal → fallback
// stubReply agar chat tetap responsif. Otak LLM hidup di ConversationReplier (core).

export interface ChatDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly reply?: ConversationReplier;
}

export interface IncomingRequest {
  readonly tenantId: TenantId;
  readonly conversationId?: string;
  readonly text: string;
}

export interface ChatReply {
  readonly conversationId: string;
  readonly outgoing: MessageEntity;
}

// Balasan fallback (tanpa agent). Persona Indonesia santai-profesional (PRD). Dipakai
// bila deps.reply tidak disuntik ATAU replier mengembalikan error (chat tak pernah mati).
export function stubReply(text: string): string {
  const snippet = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return `Siaaap, pesan kamu udah kecatat: "${snippet}". Balasan otomatis nih — agent AI beneran baru hadir di tahap berikutnya. 🚧`;
}

export async function handleIncoming(
  deps: ChatDeps,
  req: IncomingRequest,
): Promise<Result<ChatReply, RepositoryError>> {
  // 1) Resolve/buat percakapan (tenant-scoped).
  let conversationId = req.conversationId;
  if (conversationId !== undefined) {
    const found = await deps.conversations.findById(req.tenantId, conversationId);
    if (!found.ok) return err(found.error);
    if (found.value === null) conversationId = undefined; // id basi → buat baru
  }
  if (conversationId === undefined) {
    const created = await deps.conversations.create(req.tenantId, { channel: 'WEB' });
    if (!created.ok) return err(created.error);
    conversationId = created.value.id;
  }

  // 2) Persist pesan masuk.
  const incoming = await deps.messages.create(req.tenantId, {
    conversationId,
    direction: 'IN',
    type: 'TEXT',
    text: req.text,
    providerMsgId: `web-in-${randomUUID()}`,
    status: 'DELIVERED',
  });
  if (!incoming.ok) return err(incoming.error);

  // 3) Susun balasan (agent loop bila tersedia, fallback stub). Persist pesan keluar.
  const replyText = await resolveReplyText(deps, req.tenantId, conversationId, req.text);
  const outgoing = await deps.messages.create(req.tenantId, {
    conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text: replyText,
    providerMsgId: `web-out-${randomUUID()}`,
    status: 'SENT',
  });
  if (!outgoing.ok) return err(outgoing.error);

  return ok({ conversationId, outgoing: outgoing.value });
}

async function resolveReplyText(
  deps: ChatDeps,
  tenantId: TenantId,
  conversationId: string,
  text: string,
): Promise<string> {
  if (!deps.reply) return stubReply(text);
  const result = await deps.reply.reply({ tenantId, conversationId, text });
  return result.ok ? result.value.text : stubReply(text);
}
