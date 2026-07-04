// Port: repository layer (SRS §4.1 shared/ports, §4.2-I "repository per agregat", §9.1).
// Implementasi konkret di packages/adapters. Domain/application bergantung ke sini.
//
// NFR-09 (isolasi tenant): SETIAP method menerima `tenantId` sebagai argumen wajib.
// Konsekuensi: query tanpa tenantId mustahil diketik (compile-time guard) — memanggil
// repo.findById(id) tanpa tenantId = TypeError di build. Runtime guard tambahan ada
// di packages/adapters/src/prisma/tenant-guard.ts (Prisma $extends).

import type { Port, Result, TenantId } from '../index.js';

// ── Error ────────────────────────────────────────────────────────────────────

export type RepositoryErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'UNKNOWN';

export interface RepositoryError {
  code: RepositoryErrorCode;
  message: string;
}

// ── Enum literal (mirror Prisma enum; shared tidak boleh import @prisma/client) ─

export type ConversationChannel = 'WA' | 'WEB';

export type ConversationState =
  | 'ONBOARDING'
  | 'INTERVIEW'
  | 'BUILDING'
  | 'REVIEW'
  | 'IDLE'
  | 'SUPPORT';

// ── Kontrak data persistence (DTO). Tanggal sebagai ISO string. ───────────────

export interface ConversationEntity {
  id: string;
  tenantId: string;
  channel: ConversationChannel;
  state: ConversationState;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationFilter {
  state?: ConversationState;
}

export interface ConversationCreateInput {
  channel: ConversationChannel;
  state?: ConversationState;
}

// Patch state percakapan (FR-CNV-001). Saat ini hanya `state`; field lain menyusul
// per use case (mis. escalatedAt untuk FR-CNV-006). Dibuat parsial agar aman dipakai
// ulang. Repo menolak update yang tidak mengubah apa pun → 'CONFLICT' bila kosong.
export interface ConversationUpdateInput {
  state?: ConversationState;
}

// ── Port ──────────────────────────────────────────────────────────────────────

export interface ConversationRepository extends Port {
  readonly name: 'ConversationRepository';
  findById(tenantId: TenantId, id: string): Promise<Result<ConversationEntity | null, RepositoryError>>;
  findMany(
    tenantId: TenantId,
    filter?: ConversationFilter,
  ): Promise<Result<ConversationEntity[], RepositoryError>>;
  create(
    tenantId: TenantId,
    input: ConversationCreateInput,
  ): Promise<Result<ConversationEntity, RepositoryError>>;
  update(
    tenantId: TenantId,
    id: string,
    input: ConversationUpdateInput,
  ): Promise<Result<ConversationEntity, RepositoryError>>;
}

// ── Message ───────────────────────────────────────────────────────────────────
// SRS §8 Message; tenantId terdenormalisasi (T-020) agar guard anti-kebocoran
// lintas-tenant bisa ditegakkan per-baris (NFR-09). providerMsgId @unique = dasar
// idempotensi webhook (FR-CHN-005) & dedup web chat.

export type MessageDirection = 'IN' | 'OUT';

export type MessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENT'
  | 'LOCATION'
  | 'INTERACTIVE';

export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface MessageEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  mediaId: string | null;
  providerMsgId: string;
  status: MessageStatus;
  createdAt: string;
}

export interface MessageCreateInput {
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  text?: string | null;
  mediaId?: string | null;
  providerMsgId: string;
  status?: MessageStatus;
}

export interface MessageRepository extends Port {
  readonly name: 'MessageRepository';
  findManyByConversation(
    tenantId: TenantId,
    conversationId: string,
  ): Promise<Result<MessageEntity[], RepositoryError>>;
  create(
    tenantId: TenantId,
    input: MessageCreateInput,
  ): Promise<Result<MessageEntity, RepositoryError>>;
}
