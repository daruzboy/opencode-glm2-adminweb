import { describe, expect, it, vi } from 'vitest';
import type { ConversationEntity, ConversationRepository, LlmJsonPort, LlmJsonRequest } from '@digimaestro/shared';
import { err, ok, tenantId } from '@digimaestro/shared';
import { advanceConversation } from './router.js';

// Fake LlmJsonPort meniru adapter deterministik (core → shared saja, dependency rule).
function makeFakeLlm<T>(responder: (req: LlmJsonRequest<T>) => unknown): LlmJsonPort {
  return {
    name: 'llm:fake',
    async completeJson(request: LlmJsonRequest<T>) {
      const parsed = request.schema.safeParse(responder(request));
      if (!parsed.success) {
        return err({ code: 'INVALID_SCHEMA', message: parsed.error.message, retryable: false, attempt: 1 });
      }
      return ok(parsed.data);
    },
  };
}

function conv(state: ConversationEntity['state']): ConversationEntity {
  return {
    id: 'c1',
    tenantId: 'tA',
    channel: 'WEB',
    state,
    escalatedAt: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  };
}

function makeRepo(over: Partial<ConversationRepository> = {}) {
  const conversations = {
    name: 'ConversationRepository',
    findById: vi.fn().mockResolvedValue(ok<ConversationEntity | null>(conv('ONBOARDING'))),
    findMany: vi.fn().mockResolvedValue(ok<ConversationEntity[]>([])),
    create: vi.fn().mockResolvedValue(ok<ConversationEntity>(conv('ONBOARDING'))),
    update: vi.fn().mockResolvedValue(ok<ConversationEntity>(conv('INTERVIEW'))),
    ...over,
  } as unknown as ConversationRepository;
  return conversations;
}

describe('advanceConversation — orkestrasi router (NFR-09: tenantId scoped)', () => {
  it('interview mengubah state ONBOARDING→INTERVIEW & memanggil update', async () => {
    const repo = makeRepo();
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'mau buat website' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intent).toBe('interview');
      expect(r.value.previousState).toBe('ONBOARDING');
      expect(r.value.state).toBe('INTERVIEW');
      expect(r.value.action).toBe('START_INTERVIEW');
      expect(r.value.changed).toBe(true);
    }
    expect(repo.update).toHaveBeenCalledWith('tA', 'c1', { state: 'INTERVIEW' });
    expect(repo.findById).toHaveBeenCalledWith('tA', 'c1');
  });

  it('status tidak mengubah state → update tidak dipanggil', async () => {
    const repo = makeRepo();
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'sampai mana nih?' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intent).toBe('status');
      expect(r.value.changed).toBe(false);
      expect(r.value.action).toBe('REPORT_STATUS');
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('revision tanpa situs (state ONBOARDING) → FALLBACK, state tetap, tanpa update', async () => {
    const repo = makeRepo();
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'ganti warna dong' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intent).toBe('revision');
      expect(r.value.action).toBe('FALLBACK');
      expect(r.value.changed).toBe(false);
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('revision saat BUILDING → REVIEW + HANDLE_REVISION + update', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(ok<ConversationEntity | null>(conv('BUILDING'))),
    });
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'tambah halaman tentang' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intent).toBe('revision');
      expect(r.value.action).toBe('HANDLE_REVISION');
      expect(r.value.previousState).toBe('BUILDING');
      expect(r.value.state).toBe('REVIEW');
      expect(r.value.changed).toBe(true);
    }
    expect(repo.update).toHaveBeenCalledWith('tA', 'c1', { state: 'REVIEW' });
  });

  it('LLM fallback dipakai saat keyword null', async () => {
    const repo = makeRepo();
    const llm = makeFakeLlm(() => ({ intent: 'status' }));
    const r = await advanceConversation(
      { conversations: repo, llm },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'film apa yang bagus' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.intent).toBe('status');
  });

  it('conversation tidak ditemukan → NOT_FOUND (error path)', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(ok<ConversationEntity | null>(null)),
    });
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'missing', text: 'halo' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('repo findById gagal → Result.err diteruskan (error path)', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(err({ code: 'UNKNOWN', message: 'db down' })),
    });
    const r = await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'halo' },
    );
    expect(r.ok).toBe(false);
  });

  it('menyuntik tenantId kaller ke SETIAP panggilan repo (no cross-tenant leak)', async () => {
    const repo = makeRepo();
    await advanceConversation(
      { conversations: repo },
      { tenantId: tenantId('tA'), conversationId: 'c1', text: 'mau buat website' },
    );
    expect(repo.findById.mock.calls[0]![0]).toBe('tA');
    expect(repo.update.mock.calls[0]![0]).toBe('tA');
  });
});
