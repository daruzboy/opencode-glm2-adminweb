// T-053: ConversationReplier — penyambung router (T-052) ke agent loop (T-053).
// Diberikan {tenantId, conversationId, text} → jalankan advanceConversation (klasifikasi
// intent + transisi state, FR-CNV-001/002) lalu composeAgentPlan (aksi → prompt+tools)
// lalu runAgentLoop (FR-AGT-006/008/010). Hasil: teks balasan untuk handle-incoming.
//
// Kegagalan routing TIDAK mematikan balasan (fallback ke plan FALLBACK) — chat tetap
// responsif; state tak terpersist hanya saat router error. Bergantung HANYA pada Port
// (shared) + use case core → diuji dengan fake, tanpa DB/jaringan.

import { err, ok } from '@digimaestro/shared';
import type {
  AgentToolScope,
  ConversationState,
  LlmAgentChatMessage,
  LlmTask,
  MessageRepository,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { runAgentLoop, type AgentLoopDeps, type AgentLoopRequest } from '../agent/agent-loop.js';
import {
  advanceConversation,
  type ConversationRouterDeps,
} from './router.js';
import type { RouterAction } from './state-machine.js';

// ── Port ConversationReplier ─────────────────────────────────────────────────
// handle-incoming (apps/api) bergantung pada port ini; implementasi = factory di bawah.

export interface ConversationReplierRequest {
  readonly tenantId: TenantId;
  readonly conversationId: string;
  readonly text: string;
  readonly jobId?: string;
}

export type ConversationReplierErrorCode = 'AGENT' | 'UNKNOWN';

export interface ConversationReplierError {
  readonly code: ConversationReplierErrorCode;
  readonly message: string;
}

export interface ConversationReplier {
  reply(req: ConversationReplierRequest): Promise<Result<{ readonly text: string }, ConversationReplierError>>;
}

// ── composeAgentPlan: mapping murni (RouterAction, state) → rencana agent ──────
// Data-driven: tiap aksi → {system prompt persona ID, task LLM, scopes tool}. Persona
// Indonesia santai-profesional (PRD). Tool konkret (sitebuilder/ops) menyusul per EPIC;
// bila registry tak punya tool pada scope itu, listTools([]) → loop tetap jalan toolless.

export interface AgentPlan {
  readonly system: string;
  readonly task: LlmTask;
  readonly scopes: readonly AgentToolScope[];
  readonly maxTokens: number;
}

export const AGENT_SYSTEM_PROMPTS = Object.freeze({
  interview:
    'Kamu asisten pembuat website UMKM Indonesia. Nada santai-profesional. ' +
    'Tugasmu memandu wawancara kebutuhan: tanyakan satu per satu field brief yang ' +
    'belum terisi (nama usaha, jenis layanan, halaman yang dibutuhkan, gaya/tema, ' +
    'kontak, aset gambar). Jangan menebak data penting — tanyakan jika belum jelas ' +
    '(FR-AGT-006). Setelah minimal nama usaha & jenis usaha terkumpul dan brief cukup, ' +
    'panggil tool `sitebuilder_build_site` untuk membuat draft situs, lalu beri tahu ' +
    'pelanggan bahwa draft siap dilihat di preview (belum dipublikasikan).',
  revision:
    'Kamu asisten revisi website UMKM Indonesia. Nada santai-profesional. ' +
    'Pelanggan minta perubahan pada situsnya. Gunakan tool sitebuilder untuk ' +
    'membaca outline situs lalu menerapkan patch revisi terstruktur (FR-AGT-004). ' +
    'Jika instruksi ambigu, tanyakan klarifikasi singkat sebelum menerapkan.',
  status:
    'Kamu asisten status UMKM Indonesia. Nada santai-profesional. ' +
    'Pelanggan menanyakan progres. Gunakan tool ops untuk memeriksa status job ' +
    'terbaru lalu jawab berdasarkan data aktual (FR-CNV-005), bukan generik.',
  fallback:
    'Kamu asisten website UMKM Indonesia. Nada santai-profesional. ' +
    'Tolak dengan sopan permintaan di luar lingkup (FR-CNV-008) dan arahkan ' +
    'pelanggan: jika ingin membuat/mengubah situs, sebutkan kebutuhannya; jika ' +
    'butuh manusia, katakan akan diteruskan ke operator.',
});

// State percakapan yang sedang BERJALAN (pelanggan di tengah alur, bukan menganggur).
const ACTIVE_STATES: readonly ConversationState[] = ['ONBOARDING', 'INTERVIEW', 'BUILDING', 'REVIEW'];

export function composeAgentPlan(
  action: RouterAction,
  state: ConversationState,
  _text: string,
): AgentPlan {
  // FALLBACK dari router = "intent tak dikenali" (router berbasis kata kunci). Di TENGAH
  // alur yang sedang berjalan itu hampir selalu SALAH: jawaban singkat pelanggan seperti
  // "Betul", "Cara 2 saja", "1. Belum punya" tak mengandung kata kunci apa pun.
  //
  // Ditemukan saat bot dipakai sungguhan: pesan-pesan itu jatuh ke prompt fallback yang
  // menyuruh model "tolak permintaan di luar lingkup" DAN scopes:[] (agent kehilangan
  // semua tool) → model bingung → membalas TEKS KOSONG → percakapan mati di tengah
  // wawancara. Selama percakapan masih aktif, lanjutkan konteksnya alih-alih menolak.
  if (action === 'FALLBACK' && ACTIVE_STATES.includes(state)) {
    return state === 'REVIEW' || state === 'BUILDING'
      ? composeAgentPlan('HANDLE_REVISION', state, _text)
      : composeAgentPlan('START_INTERVIEW', state, _text);
  }

  switch (action) {
    case 'START_INTERVIEW':
      // T-053e: interview kini boleh memakai tool sitebuilder — setelah brief cukup, agent
      // memanggil `sitebuilder_build_site` untuk membuat DRAFT (approval-first tetap terjaga:
      // draft ≠ publish). Situs baru jadi bisa dibangun langsung dari alur wawancara.
      return { system: AGENT_SYSTEM_PROMPTS.interview, task: 'interview', scopes: ['sitebuilder'], maxTokens: 2048 };
    case 'HANDLE_REVISION':
      return {
        system: AGENT_SYSTEM_PROMPTS.revision,
        task: 'revision_patch',
        scopes: ['sitebuilder'],
        maxTokens: 2560,
      };
    case 'REPORT_STATUS':
      return { system: AGENT_SYSTEM_PROMPTS.status, task: 'intent', scopes: ['ops'], maxTokens: 1536 };
    case 'FALLBACK':
      return { system: AGENT_SYSTEM_PROMPTS.fallback, task: 'interview', scopes: [], maxTokens: 1536 };
  }
}

// ── Factory: createAgentReplier ───────────────────────────────────────────────

export interface AgentReplierDeps {
  readonly router: ConversationRouterDeps;
  readonly loop: AgentLoopDeps;
  readonly loopOptions?: Pick<AgentLoopRequest, 'maxSteps' | 'temperature'>;
  // Riwayat percakapan (T-053f). TANPA ini agent amnesia: tiap pesan diperlakukan seolah
  // yang pertama, sehingga wawancara slot-filling (FR-CNV-003) tak pernah selesai —
  // pengguna menyebut nama usaha di pesan #1, lalu di pesan #2 agent bertanya lagi.
  // Ditemukan saat uji bot NYATA; fake di unit test tak pernah menangkapnya karena
  // tiap tes hanya mengirim satu pesan.
  readonly messages?: MessageRepository;
}

// Berapa pesan terakhir yang dibawa ke LLM. Cukup untuk wawancara 5 slot, tapi tak
// membiarkan prompt (dan biaya token) tumbuh tanpa batas di percakapan panjang.
export const DEFAULT_HISTORY_LIMIT = 20;

const DEFAULT_ROUTER_ACTION: RouterAction = 'FALLBACK';

export function createAgentReplier(deps: AgentReplierDeps): ConversationReplier {
  return {
    async reply(req) {
      // 1) Routing (best-effort: kegagalan tidak mematikan balasan).
      let action: RouterAction = DEFAULT_ROUTER_ACTION;
      // State percakapan NYATA. Sebelumnya replier mengoper 'ONBOARDING' hardcoded dan
      // composeAgentPlan mengabaikannya (_state) — jadi state tak pernah berpengaruh.
      let state: ConversationState = 'ONBOARDING';
      const routed = await advanceConversation(deps.router, {
        tenantId: req.tenantId,
        conversationId: req.conversationId,
        text: req.text,
        jobId: req.jobId,
      });
      if (routed.ok) {
        action = routed.value.action;
        state = routed.value.state;
      }

      // 2) Rencana agent berdasarkan aksi.
      const plan = composeAgentPlan(action, state, req.text);

      // 3) Riwayat percakapan → agent ingat apa yang sudah dibahas (best-effort:
      //    kegagalan memuat riwayat tak boleh mematikan balasan).
      const history = await loadHistory(deps, req);

      // 4) Agent loop.
      const loopResult = await runAgentLoop(deps.loop, {
        tenantId: req.tenantId,
        actor: 'chatbot',
        scopes: plan.scopes,
        task: plan.task,
        system: plan.system,
        userMessage: req.text,
        ...(history.length > 0 ? { history } : {}),
        jobId: req.jobId,
        maxTokens: plan.maxTokens,
        ...deps.loopOptions,
      });
      if (!loopResult.ok) {
        return err({ code: 'AGENT', message: loopResult.error.message });
      }
      return ok({ text: loopResult.value.reply });
    },
  };
}

// Riwayat → pesan chat LLM. Pesan TERAKHIR dilewati bila itu pesan masuk yang sedang
// diproses (handle-inbound sudah mem-persist-nya sebelum memanggil replier) — kalau tidak,
// teks yang sama akan muncul dua kali: sekali di history, sekali sebagai userMessage.
async function loadHistory(
  deps: AgentReplierDeps,
  req: ConversationReplierRequest,
): Promise<readonly LlmAgentChatMessage[]> {
  if (!deps.messages) return [];

  const found = await deps.messages.findManyByConversation(req.tenantId, req.conversationId);
  if (!found.ok) return [];

  const rows = found.value.filter(
    (m) => m.type === 'TEXT' && m.text !== null && m.text.trim().length > 0,
  );

  // Buang duplikat pesan yang sedang diproses (paling belakang, arah IN, teks sama).
  const last = rows[rows.length - 1];
  const withoutCurrent =
    last && last.direction === 'IN' && last.text === req.text ? rows.slice(0, -1) : rows;

  return withoutCurrent.slice(-DEFAULT_HISTORY_LIMIT).map((m) => ({
    role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
    content: m.text as string,
  }));
}
