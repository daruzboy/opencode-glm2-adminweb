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
  LlmTask,
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

export function composeAgentPlan(action: RouterAction, _state: ConversationState, _text: string): AgentPlan {
  switch (action) {
    case 'START_INTERVIEW':
      // T-053e: interview kini boleh memakai tool sitebuilder — setelah brief cukup, agent
      // memanggil `sitebuilder_build_site` untuk membuat DRAFT (approval-first tetap terjaga:
      // draft ≠ publish). Situs baru jadi bisa dibangun langsung dari alur wawancara.
      return { system: AGENT_SYSTEM_PROMPTS.interview, task: 'interview', scopes: ['sitebuilder'], maxTokens: 512 };
    case 'HANDLE_REVISION':
      return {
        system: AGENT_SYSTEM_PROMPTS.revision,
        task: 'revision_patch',
        scopes: ['sitebuilder'],
        maxTokens: 768,
      };
    case 'REPORT_STATUS':
      return { system: AGENT_SYSTEM_PROMPTS.status, task: 'intent', scopes: ['ops'], maxTokens: 384 };
    case 'FALLBACK':
      return { system: AGENT_SYSTEM_PROMPTS.fallback, task: 'interview', scopes: [], maxTokens: 384 };
  }
}

// ── Factory: createAgentReplier ───────────────────────────────────────────────

export interface AgentReplierDeps {
  readonly router: ConversationRouterDeps;
  readonly loop: AgentLoopDeps;
  readonly loopOptions?: Pick<AgentLoopRequest, 'maxSteps' | 'temperature'>;
}

const DEFAULT_ROUTER_ACTION: RouterAction = 'FALLBACK';

export function createAgentReplier(deps: AgentReplierDeps): ConversationReplier {
  return {
    async reply(req) {
      // 1) Routing (best-effort: kegagalan tidak mematikan balasan).
      let action: RouterAction = DEFAULT_ROUTER_ACTION;
      const routed = await advanceConversation(deps.router, {
        tenantId: req.tenantId,
        conversationId: req.conversationId,
        text: req.text,
        jobId: req.jobId,
      });
      if (routed.ok) action = routed.value.action;

      // 2) Rencana agent berdasarkan aksi.
      const plan = composeAgentPlan(action, 'ONBOARDING', req.text);

      // 3) Agent loop.
      const loopResult = await runAgentLoop(deps.loop, {
        tenantId: req.tenantId,
        actor: 'chatbot',
        scopes: plan.scopes,
        task: plan.task,
        system: plan.system,
        userMessage: req.text,
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
