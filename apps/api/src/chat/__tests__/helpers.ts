import { vi } from 'vitest';
import type { ConversationEntity, MessageEntity } from '@digimaestro/shared';
import { ok } from '@digimaestro/shared';
import type { ChatDeps } from '../handle-incoming.js';

export function conv(id = 'c1', tenantId = 'tA'): ConversationEntity {
  return {
    id,
    tenantId,
    channel: 'WEB',
    state: 'ONBOARDING',
    escalatedAt: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  };
}

export function msg(
  id = 'm1',
  direction: 'IN' | 'OUT' = 'OUT',
  text = 'halo',
  conversationId = 'c1',
  tenantId = 'tA',
): MessageEntity {
  return {
    id,
    tenantId,
    conversationId,
    direction,
    type: 'TEXT',
    text,
    mediaId: null,
    providerMsgId: 'web-' + id,
    status: direction === 'IN' ? 'DELIVERED' : 'SENT',
    createdAt: '2026-07-04T00:00:00.000Z',
  };
}

export interface FakeDeps {
  deps: ChatDeps;
  conversations: {
    findById: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  messages: {
    findManyByConversation: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

export function makeFakeDeps(): FakeDeps {
  const conversations = {
    name: 'ConversationRepository',
    findById: vi.fn().mockResolvedValue(ok<ConversationEntity | null>(null)),
    findMany: vi.fn().mockResolvedValue(ok<ConversationEntity[]>([])),
    create: vi.fn().mockResolvedValue(ok<ConversationEntity>(conv('c-new'))),
  };
  const messages = {
    name: 'MessageRepository',
    findManyByConversation: vi.fn().mockResolvedValue(ok<MessageEntity[]>([])),
    create: vi.fn().mockResolvedValue(ok<MessageEntity>(msg('m-out', 'OUT'))),
  };
  return {
    conversations,
    messages,
    deps: { conversations, messages } as unknown as ChatDeps,
  };
}
