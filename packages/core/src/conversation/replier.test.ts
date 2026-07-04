import { describe, expect, it, vi } from 'vitest';
import {
  err,
  ok,
  tenantId,
  type ConversationEntity,
  type ConversationRepository,
  type LlmAgentPort,
  type LlmAgentResponse,
} from '@digimaestro/shared';
import {
  AGENT_SYSTEM_PROMPTS,
  composeAgentPlan,
  createAgentReplier,
} from './replier.js';
import { createAgentToolRegistry } from '../agent/tool-registry.js';

const tenant = tenantId('tA');

function fakeLlmAgent(responder: () => LlmAgentResponse): LlmAgentPort & { calls: number } {
  let calls = 0;
  return {
    name: 'llm-agent:fake',
    async completeWithTools() {
      calls += 1;
      return ok(responder());
    },
    get calls() {
      return calls;
    },
  } as LlmAgentPort & { calls: number };
}

function conv(id: string, state: ConversationEntity['state'] = 'ONBOARDING'): ConversationEntity {
  return {
    id,
    tenantId: 'tA',
    channel: 'WEB',
    state,
    escalatedAt: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  };
}

function fakeConversationRepo(overrides: Partial<ConversationRepository> = {}): ConversationRepository {
  return {
    name: 'ConversationRepository',
    findById: vi.fn().mockResolvedValue(ok<ConversationEntity | null>(conv('c1'))),
    findMany: vi.fn().mockResolvedValue(ok<ConversationEntity[]>([])),
    create: vi.fn().mockResolvedValue(ok(conv('c1'))),
    update: vi.fn().mockResolvedValue(ok(conv('c1', 'INTERVIEW'))),
    ...overrides,
  } as unknown as ConversationRepository;
}

describe('composeAgentPlan (RouterAction → rencana agent)', () => {
  it('START_INTERVIEW → task interview, tanpa tool', () => {
    const plan = composeAgentPlan('START_INTERVIEW', 'ONBOARDING', 'mau buat web');
    expect(plan.task).toBe('interview');
    expect(plan.scopes).toEqual([]);
    expect(plan.system).toBe(AGENT_SYSTEM_PROMPTS.interview);
  });

  it('HANDLE_REVISION → task revision_patch, scope sitebuilder', () => {
    const plan = composeAgentPlan('HANDLE_REVISION', 'REVIEW', 'ganti judul');
    expect(plan.task).toBe('revision_patch');
    expect(plan.scopes).toEqual(['sitebuilder']);
  });

  it('REPORT_STATUS → task intent, scope ops', () => {
    const plan = composeAgentPlan('REPORT_STATUS', 'BUILDING', 'sampai mana?');
    expect(plan.task).toBe('intent');
    expect(plan.scopes).toEqual(['ops']);
  });

  it('FALLBACK → task interview, tanpa tool', () => {
    const plan = composeAgentPlan('FALLBACK', 'IDLE', 'hai');
    expect(plan.task).toBe('interview');
    expect(plan.scopes).toEqual([]);
    expect(plan.system).toBe(AGENT_SYSTEM_PROMPTS.fallback);
  });
});

describe('createAgentReplier', () => {
  it('happy path: route (intent keyword) → loop → balas teks; state di-persist', async () => {
    const conversations = fakeConversationRepo();
    const llm = fakeLlmAgent(() => ({ kind: 'text', content: 'Oke, mulai wawancara ya!' }));

    const replier = createAgentReplier({
      router: { conversations },
      loop: { llm, tools: createAgentToolRegistry([]) },
    });

    const r = await replier.reply({ tenantId: tenant, conversationId: 'c1', text: 'mau buat website' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('Oke, mulai wawancara ya!');
    // intent 'interview' dari keyword → ONBOARDING→INTERVIEW (changed) → update dipanggil
    expect(conversations.update).toHaveBeenCalledTimes(1);
    expect(llm.calls).toBe(1);
  });

  it('fallback: kegagalan routing tidak mematikan balasan (loop tetap jalan dgn plan FALLBACK)', async () => {
    const conversations = fakeConversationRepo({
      findById: vi.fn().mockResolvedValue(err({ code: 'UNKNOWN', message: 'db down' })),
    });
    const llm = fakeLlmAgent(() => ({ kind: 'text', content: 'maaf, ada gangguan' }));

    const replier = createAgentReplier({
      router: { conversations },
      loop: { llm, tools: createAgentToolRegistry([]) },
    });

    const r = await replier.reply({ tenantId: tenant, conversationId: 'c1', text: 'halo' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('maaf, ada gangguan');
    expect(conversations.update).not.toHaveBeenCalled();
    expect(llm.calls).toBe(1);
  });

  it('error agent loop → Result.err code AGENT', async () => {
    const conversations = fakeConversationRepo();
    const llm: LlmAgentPort = {
      name: 'llm-agent:failing',
      async completeWithTools() {
        return err({ code: 'HTTP', message: 'down', retryable: false, attempt: 1 });
      },
    };

    const replier = createAgentReplier({
      router: { conversations },
      loop: { llm, tools: createAgentToolRegistry([]) },
    });

    const r = await replier.reply({ tenantId: tenant, conversationId: 'c1', text: 'mau buat web' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('AGENT');
  });

  it('menyuntik tenantId ke loop (NFR-09)', async () => {
    const conversations = fakeConversationRepo();
    let seenTenant: unknown;
    const llm: LlmAgentPort = {
      name: 'llm-agent:spy',
      async completeWithTools(req) {
        seenTenant = req.tenantId;
        return ok({ kind: 'text', content: 'hi' });
      },
    };

    const replier = createAgentReplier({
      router: { conversations },
      loop: { llm, tools: createAgentToolRegistry([]) },
    });

    await replier.reply({ tenantId: tenant, conversationId: 'c1', text: 'mau buat web' });
    expect(String(seenTenant)).toBe('tA');
  });
});
