import { describe, expect, it, vi } from 'vitest';
import type { Message as PrismaMessage } from '@prisma/client';
import { tenantId } from '@digimaestro/shared';

import { MessageRepositoryPrisma } from '../message-repo-prisma.js';
import type { MessageDelegate } from '../message-repo-prisma.js';

function row(over: Partial<PrismaMessage> = {}): PrismaMessage {
  return {
    id: 'm1',
    tenantId: 'tA',
    conversationId: 'c1',
    direction: 'IN',
    type: 'TEXT',
    text: 'hai',
    mediaId: null,
    providerMsgId: 'web-1',
    status: 'DELIVERED',
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    ...over,
  } as PrismaMessage;
}

function makeDelegate(impl: {
  findMany?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}): MessageDelegate {
  return {
    findMany: impl.findMany ?? vi.fn(),
    create: impl.create ?? vi.fn(),
  } as unknown as MessageDelegate;
}

describe('MessageRepositoryPrisma — NFR-09: tenantId always scoped', () => {
  it('findManyByConversation injects tenantId + conversationId + orders by createdAt asc', async () => {
    const findMany = vi.fn().mockResolvedValue([row(), row({ id: 'm2' })]);
    const repo = new MessageRepositoryPrisma(makeDelegate({ findMany }));

    const r = await repo.findManyByConversation(tenantId('tA'), 'c1');

    expect(r.ok).toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tA', conversationId: 'c1' },
      orderBy: { createdAt: 'asc' },
    });
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it('create injects tenantId into data and maps Date → ISO', async () => {
    const create = vi.fn().mockResolvedValue(row({ direction: 'OUT', text: 'halo' }));
    const repo = new MessageRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), {
      conversationId: 'c1',
      direction: 'OUT',
      type: 'TEXT',
      text: 'halo',
      providerMsgId: 'web-out-1',
    });

    expect(r.ok).toBe(true);
    expect(create.mock.calls[0]![0].data.tenantId).toBe('tA');
    expect(create.mock.calls[0]![0].data.providerMsgId).toBe('web-out-1');
    if (r.ok && r.value) {
      expect(r.value.direction).toBe('OUT');
      expect(r.value.createdAt).toBe('2026-07-04T00:00:00.000Z');
    }
  });

  it('returns RepositoryError on delegate failure (error path)', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('boom'));
    const repo = new MessageRepositoryPrisma(makeDelegate({ findMany }));

    const r = await repo.findManyByConversation(tenantId('tA'), 'c1');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN');
  });
});

// T-030tg: dasar idempotensi webhook (FR-CHN-005). providerMsgId @unique → INSERT ke-2
// atas pesan yang sama melanggar constraint; itu duplikat, bukan kegagalan DB.
describe('MessageRepositoryPrisma.create — dedup providerMsgId', () => {
  it('P2002 → CONFLICT (dipakai use case sbg penanda duplikat)', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const repo = new MessageRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), {
      conversationId: 'c1',
      direction: 'IN',
      type: 'TEXT',
      text: 'halo',
      providerMsgId: 'tg-555-42',
      status: 'DELIVERED',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
  });

  it('error DB lain tetap UNKNOWN (tidak disalahartikan sbg duplikat)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('koneksi putus'));
    const repo = new MessageRepositoryPrisma(makeDelegate({ create }));

    const r = await repo.create(tenantId('tA'), {
      conversationId: 'c1',
      direction: 'IN',
      type: 'TEXT',
      providerMsgId: 'tg-555-43',
      status: 'DELIVERED',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNKNOWN');
  });
});
