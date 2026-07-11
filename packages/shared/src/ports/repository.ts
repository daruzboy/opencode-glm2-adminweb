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

// TELEGRAM (T-030tg): kanal masuk Fase 0. WABA (WA) diparkir menunggu verifikasi Meta —
// keduanya dinormalisasi ke InboundChannelMessage (ports/channel.ts) sehingga use case
// percakapan tak tahu-menahu soal vendor kanal.
export type ConversationChannel = 'WA' | 'WEB' | 'TELEGRAM';

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
  // Id percakapan di sisi penyedia kanal (Telegram chat_id, nomor WA). NULL untuk WEB
  // (percakapan dirujuk via id internal). Unik per (tenantId, channel, externalId) →
  // pesan berikutnya dari chat yang sama mendarat di Conversation yang sama.
  externalId: string | null;
  state: ConversationState;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationFilter {
  state?: ConversationState;
  // Saring per kanal (T-032tg): worker publish memakai ini untuk menemukan percakapan
  // Telegram milik tenant → tahu ke chat mana notifikasi "situs sudah live" dikirim.
  channel?: ConversationChannel;
}

export interface ConversationCreateInput {
  channel: ConversationChannel;
  externalId?: string | null;
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
  // Resolusi percakapan untuk kanal eksternal (T-030tg): chat_id Telegram → Conversation.
  // Kunci (tenantId, channel, externalId) unik → dipakai webhook agar pesan susulan dari
  // chat yang sama tidak membuat percakapan baru.
  findByExternalId(
    tenantId: TenantId,
    channel: ConversationChannel,
    externalId: string,
  ): Promise<Result<ConversationEntity | null, RepositoryError>>;
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

// ── Website ───────────────────────────────────────────────────────────────────
// SRS §8 Website (tenantId @unique = satu website per tenant, BRU-01). Status
// mengikuti state machine SRS §6.1. Dipakai pipeline publish & agent builder.

export type WebsiteStatus =
  | 'DRAFTING'
  | 'PREVIEW_READY'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUSPENDED'
  | 'ARCHIVED';

export interface WebsiteEntity {
  id: string;
  tenantId: string;
  slug: string;
  status: WebsiteStatus;
  publishedRevisionId: string | null;
  themeId: string | null;
  deploymentTargetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteUpdateInput {
  status?: WebsiteStatus;
  publishedRevisionId?: string | null;
}

// Input pembuatan Website (onboarding, T-020ext/A). slug @unique global; status default
// DRAFTING. tenantId @unique → satu website per tenant (BRU-01) → create ke-2 = CONFLICT.
export interface WebsiteCreateInput {
  slug: string;
  status?: WebsiteStatus;
  themeId?: string | null;
}

export interface WebsiteRepository extends Port {
  readonly name: 'WebsiteRepository';
  findByTenantId(tenantId: TenantId): Promise<Result<WebsiteEntity | null, RepositoryError>>;
  create(
    tenantId: TenantId,
    input: WebsiteCreateInput,
  ): Promise<Result<WebsiteEntity, RepositoryError>>;
  update(
    tenantId: TenantId,
    websiteId: string,
    input: WebsiteUpdateInput,
  ): Promise<Result<WebsiteEntity, RepositoryError>>;
}

// ── Revision ──────────────────────────────────────────────────────────────────
// SRS §8 Revision (snapshot immutable Site Document per perubahan agent). Status
// mengikuti state machine DRAFT→PREVIEW→APPROVED→PUBLISHED|REJECTED (SRS §6.1).
// Revision tidak punya tenantId langsung → scope via Website (tenantId) di setiap
// method (NFR-09: tenant guard mengecek Website milik tenant DULU).

export type RevisionStatus = 'DRAFT' | 'PREVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED';

export interface RevisionEntity {
  id: string;
  websiteId: string;
  number: number;
  siteDoc: unknown;
  summary: string | null;
  status: RevisionStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionCreateInput {
  websiteId: string;
  siteDoc: unknown;
  summary?: string;
  createdBy: string;
  status?: RevisionStatus;
}

export interface RevisionUpdateInput {
  status?: RevisionStatus;
  summary?: string;
}

export interface RevisionRepository extends Port {
  readonly name: 'RevisionRepository';
  findById(
    tenantId: TenantId,
    websiteId: string,
    revisionId: string,
  ): Promise<Result<RevisionEntity | null, RepositoryError>>;
  findLatest(
    tenantId: TenantId,
    websiteId: string,
  ): Promise<Result<RevisionEntity | null, RepositoryError>>;
  create(
    tenantId: TenantId,
    input: RevisionCreateInput,
  ): Promise<Result<RevisionEntity, RepositoryError>>;
  update(
    tenantId: TenantId,
    websiteId: string,
    revisionId: string,
    input: RevisionUpdateInput,
  ): Promise<Result<RevisionEntity, RepositoryError>>;
}
