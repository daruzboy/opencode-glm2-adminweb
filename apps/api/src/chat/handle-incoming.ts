import { randomUUID } from 'node:crypto';
import type {
  ConversationRepository,
  InboundRateLimiterPort,
  MessageEntity,
  MessageRepository,
  QuotaPort,
  RepositoryError,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { err, ok } from '@digimaestro/shared';
import { quotaExhaustedReply, rateLimitedReply, type ConversationReplier } from '@digimaestro/core';

// Use case web chat (T-040). Bergantung hanya pada Port (shared/core) → diuji dengan fake.
// Menyuntik tenantId ke SETIAP panggilan repo (NFR-09). Kanal web & WA berbagi
// Conversation/Message yang sama → riwayat terpadu per tenant (FR-CHN-003).
//
// T-053: deps.reply opsional (agent loop nyata). Bila tidak disuntik / gagal → fallback
// stubReply agar chat tetap responsif. Otak LLM hidup di ConversationReplier (core).
//
// Audit 2026-07-16: gerbang biaya (rate limit + kuota) SAMA dengan jalur Telegram
// (core handle-inbound P0/#6) — sebelumnya hanya kanal Telegram yang dipagari, sehingga
// satu tenant bisa membakar token LLM tanpa batas lewat WebSocket. Keduanya opsional:
// tanpa Redis/DB (dev) chat tetap jalan tanpa gerbang, seperti worker.

export interface ChatDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly reply?: ConversationReplier;
  // Gerbang banjir per tenant — dicek SEBELUM LLM (rate limit keluar tak menjaga token).
  readonly rateLimiter?: InboundRateLimiterPort;
  // Gerbang total per tenant (kuota pesan trial/langganan).
  readonly quota?: QuotaPort;
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

  // 3) GERBANG BIAYA — urutan & alasan sama dengan core handle-inbound: tolak DI SINI,
  //    sebelum LLM dipanggil. Balasan gerbang dikirim sebagai pesan OUT biasa (di web,
  //    membalas cuma frame WS ke klien yang sama — tak ada biaya kirim kanal seperti
  //    Telegram, jadi tak perlu logika "peringatkan sekali per jendela").
  if (deps.rateLimiter) {
    const decision = await deps.rateLimiter.check(req.tenantId);
    if (!decision.allowed) {
      return persistOutgoing(deps, req.tenantId, conversationId, rateLimitedReply(decision.retryAfterSec));
    }
  }

  if (deps.quota) {
    const q = await deps.quota.check(req.tenantId);
    if (!q.ok) return err(q.error);
    if (!q.value.allowed) {
      return persistOutgoing(deps, req.tenantId, conversationId, quotaExhaustedReply(q.value.reason ?? 'MESSAGES'));
    }
    // Konsumsi SETELAH lolos, SEBELUM LLM (pesan gagal di tengah tetap membakar token).
    const consumed = await deps.quota.consume(req.tenantId);
    if (!consumed.ok) return err(consumed.error);
  }

  // 4) Susun balasan (agent loop bila tersedia, fallback stub). Persist pesan keluar.
  const replyText = await resolveReplyText(deps, req.tenantId, conversationId, req.text);
  return persistOutgoing(deps, req.tenantId, conversationId, replyText);
}

async function persistOutgoing(
  deps: ChatDeps,
  tenantId: TenantId,
  conversationId: string,
  text: string,
): Promise<Result<ChatReply, RepositoryError>> {
  const outgoing = await deps.messages.create(tenantId, {
    conversationId,
    direction: 'OUT',
    type: 'TEXT',
    text,
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
