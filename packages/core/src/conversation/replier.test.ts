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
  it('START_INTERVIEW → task interview, scope sitebuilder (T-053e: build dari brief)', () => {
    const plan = composeAgentPlan('START_INTERVIEW', 'ONBOARDING', 'mau buat web');
    expect(plan.task).toBe('interview');
    expect(plan.scopes).toEqual(['sitebuilder']);
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

// T-053f — DITEMUKAN SAAT UJI BOT NYATA: agent amnesia. Pengguna menyebut "Sate Pak Dar"
// di pesan #1; di pesan #2 agent menjawab "Nama usaha: Belum disebut". Wawancara
// slot-filling (FR-CNV-003) tak akan pernah selesai → situs tak pernah terbangun.
// Unit test lama tak menangkapnya karena tiap tes cuma mengirim SATU pesan.
describe('createAgentReplier — riwayat percakapan (anti-amnesia)', () => {
  function historyDeps(rows: unknown[]) {
    const captured: { history?: readonly { role: string; content: string }[] } = {};
    const llm = {
      completeWithTools: vi.fn(
        async (req: { messages: readonly { role: string; content: string }[] }) => {
          // messages = system + history + userMessage
          captured.history = req.messages.filter((m) => m.role !== 'system');
          return ok({ kind: 'text' as const, content: 'oke' });
        },
      ),
    };
    const deps = {
      router: { conversations: { findById: vi.fn(async () => ok(null)), update: vi.fn() } },
      messages: { findManyByConversation: vi.fn(async () => ok(rows)) },
      loop: { llm, tools: createAgentToolRegistry([]) },
    } as never;
    return { deps, captured };
  }

  function row(direction: 'IN' | 'OUT', text: string) {
    return { id: text, tenantId: 't1', conversationId: 'c1', direction, type: 'TEXT', text, mediaId: null, providerMsgId: text, status: 'SENT', createdAt: '' };
  }

  it('pesan sebelumnya diteruskan ke LLM sebagai history user/assistant', async () => {
    const { deps, captured } = historyDeps([
      row('IN', 'warungku namanya Sate Pak Dar'),
      row('OUT', 'Halo! Mau website seperti apa?'),
      row('IN', 'warna merah kuning'),
    ]);

    await createAgentReplier(deps).reply({
      tenantId: tenantId('t1'),
      conversationId: 'c1',
      text: 'warna merah kuning',
    });

    const roles = captured.history?.map((m) => m.role);
    const contents = captured.history?.map((m) => m.content) ?? [];
    // Nama usaha dari pesan #1 HARUS sampai ke LLM.
    expect(contents.some((c) => c.includes('Sate Pak Dar'))).toBe(true);
    expect(roles).toContain('assistant'); // balasan bot sebelumnya ikut → konteks utuh
  });

  // Kalau tidak dibuang, teks yang sama muncul dua kali (di history & sebagai userMessage).
  it('pesan yang sedang diproses tidak diduplikasi ke history', async () => {
    const { deps, captured } = historyDeps([row('IN', 'halo'), row('IN', 'pesan sekarang')]);

    await createAgentReplier(deps).reply({
      tenantId: tenantId('t1'),
      conversationId: 'c1',
      text: 'pesan sekarang',
    });

    const sekarang = (captured.history ?? []).filter((m) => m.content === 'pesan sekarang');
    expect(sekarang).toHaveLength(1);
  });

  it('tanpa repo messages → tetap membalas (history opsional)', async () => {
    const llm = {
      completeWithTools: vi.fn(async () => ok({ kind: 'text' as const, content: 'oke' })),
    };
    const deps = {
      router: { conversations: { findById: vi.fn(async () => ok(null)), update: vi.fn() } },
      loop: { llm, tools: createAgentToolRegistry([]) },
    } as never;

    const res = await createAgentReplier(deps).reply({
      tenantId: tenantId('t1'),
      conversationId: 'c1',
      text: 'halo',
    });

    expect(res.ok).toBe(true);
  });
});

// DITEMUKAN SAAT BOT DIPAKAI SUNGGUHAN (wawancara "Siramaja"): pelanggan menjawab singkat
// ("Betul", "Cara 2 saja", "1. Belum punya") → router keyword tak mengenali intent →
// FALLBACK → prompt "TOLAK permintaan di luar lingkup" + scopes:[] (agent kehilangan SEMUA
// tool) → model bingung → balas TEKS KOSONG → percakapan mati di tengah wawancara.
//
// Router sebenarnya sudah menghitung state dengan benar; replier membuangnya (mengoper
// 'ONBOARDING' hardcoded) dan composeAgentPlan mengabaikannya (_state).
describe('composeAgentPlan — hormati state percakapan', () => {
  it('FALLBACK saat INTERVIEW → lanjutkan wawancara, tools TETAP ADA', () => {
    const plan = composeAgentPlan('FALLBACK', 'INTERVIEW', 'Cara 2 saja');

    expect(plan.scopes).toContain('sitebuilder');
    // Jangan pakai prompt penolakan di tengah wawancara.
    expect(plan.system).not.toContain('Tolak dengan sopan');
  });

  it('FALLBACK saat ONBOARDING → wawancara (bukan penolakan)', () => {
    const plan = composeAgentPlan('FALLBACK', 'ONBOARDING', 'Betul');
    expect(plan.scopes).toContain('sitebuilder');
  });

  it('FALLBACK saat REVIEW → jalur revisi (pelanggan sedang menilai draft)', () => {
    const plan = composeAgentPlan('FALLBACK', 'REVIEW', 'yang itu aja');
    expect(plan.scopes).toContain('sitebuilder');
  });

  // FALLBACK memang benar saat pelanggan TIDAK sedang di tengah alur.
  it('FALLBACK saat IDLE → tetap prompt penolakan sopan (FR-CNV-008)', () => {
    const plan = composeAgentPlan('FALLBACK', 'IDLE', 'ramalan cuaca dong');

    expect(plan.scopes).toHaveLength(0);
    expect(plan.system).toContain('Tolak dengan sopan');
  });

  it('aksi eksplisit tidak terpengaruh state', () => {
    expect(composeAgentPlan('REPORT_STATUS', 'INTERVIEW', 'status?').scopes).toContain('ops');
  });
});

// DITEMUKAN SAAT BOT DIPAKAI SUNGGUHAN + diukur langsung ke API DeepSeek:
// deepseek-v4-pro adalah model REASONING — ia menghabiskan token untuk "berpikir" DULU,
// baru menulis jawaban. Dengan maxTokens 512, SELURUH anggaran habis di reasoning
// (finish_reason 'length', reasoning 1912 char) dan `content` yang sampai ke pengguna
// KOSONG → bot tampak mati tanpa sebab. Terukur: 2048 cukup.
describe('anggaran token — cukup untuk model reasoning', () => {
  it.each([
    ['START_INTERVIEW', 'ONBOARDING'],
    ['HANDLE_REVISION', 'REVIEW'],
    ['REPORT_STATUS', 'IDLE'],
    ['FALLBACK', 'IDLE'],
  ] as const)('%s → maxTokens ≥ 1536 (menyisakan ruang untuk jawaban)', (action, state) => {
    const plan = composeAgentPlan(action, state, 'halo');
    expect(plan.maxTokens).toBeGreaterThanOrEqual(1536);
  });
});
