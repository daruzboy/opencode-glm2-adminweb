// T-053: agent loop orchestration (SRS §5.2; FR-AGT-006/008/010).
// Orkestrasi provider-agnostic: LlmAgentPort (chat+tools) + AgentToolRegistry +
// executeFunctionToolCalls. Murni dari sisi I/O (hanya lewat port) → diuji dgn fake.
//
// Alur (per step):
//   1) minta kelanjutan ke LlmAgentPort dgn tools aktif (toOpenAiToolDefinition).
//   2) bila keluaran = teks → selesai (reply final).
//   3) bila keluaran = tool_calls → eksekusi paralel via bridge, append pesan
//      assistant(toolCalls) + tiap hasil role 'tool' ke riwayat, lanjut step.
//   4) setelah (maxSteps-1) round tool-call tercapai → satu panggilan TANPA tools
//      untuk memaksa ringkasan teks (anti loop tak terhingga; NEEDS_INFO FR-AGT-006
//      ditangani lewat prompt saat info masih kurang).

import { err, ok } from '@digimaestro/shared';
import type {
  AgentToolContext,
  AgentToolRegistry,
  AgentToolScope,
  LlmAgentChatMessage,
  LlmAgentPort,
  LlmError,
  LlmTask,
  Result,
  TenantId,
} from '@digimaestro/shared';
import { toOpenAiToolDefinition } from '@digimaestro/shared';
import { executeFunctionToolCalls } from './function-call-bridge.js';

export interface AgentLoopDeps {
  readonly llm: LlmAgentPort;
  readonly tools: AgentToolRegistry;
}

export interface AgentLoopRequest {
  readonly tenantId: TenantId;
  readonly actor: string;
  readonly scopes: readonly AgentToolScope[];
  readonly task: LlmTask;
  readonly system: string;
  readonly userMessage: string;
  readonly history?: readonly LlmAgentChatMessage[];
  readonly jobId?: string;
  readonly maxSteps?: number; // jumlah maks. round (default 4)
  readonly maxTokens?: number; // default 512
  readonly temperature?: number;
}

export interface AgentLoopResult {
  readonly reply: string;
  readonly steps: number;
  readonly toolCallsUsed: number;
}

export const DEFAULT_AGENT_MAX_STEPS = 4;
export const DEFAULT_AGENT_MAX_TOKENS = 512;

// Pesan NEEDS_INFO terakhir saat loop menyentuh batas langkah (FR-AGT-006). Tidak
// menebak data penting; meminta klien merinci.
// Instruksi penutup saat tools dimatikan (langkah terakhir). Tanpa ini model mencoba
// "memanggil tool" lewat teks biasa.
export const NO_TOOLS_INSTRUCTION = [
  'PENTING: tool sudah TIDAK tersedia pada giliran ini.',
  'Jangan menulis pemanggilan tool dalam bentuk apa pun (tanpa markup, tanpa "Memanggil ...").',
  'Balas langsung ke pengguna dengan bahasa Indonesia yang wajar berdasarkan hasil yang sudah ada.',
].join(' ');

export const AGENT_MAX_STEPS_REPLY =
  'Maaf, aku masih butuh beberapa detail lagi biar bisa lanjut. ' +
  'Bisa tolong sebutkan poin utama yang kamu maksud agar aku bantu lebih tepat?';

export async function runAgentLoop(
  deps: AgentLoopDeps,
  req: AgentLoopRequest,
): Promise<Result<AgentLoopResult, LlmError>> {
  const maxSteps = Math.max(1, req.maxSteps ?? DEFAULT_AGENT_MAX_STEPS);
  const maxTokens = req.maxTokens ?? DEFAULT_AGENT_MAX_TOKENS;
  const context: AgentToolContext = {
    tenantId: req.tenantId,
    actor: req.actor,
    scopes: req.scopes,
  };

  const tools = deps.tools.listTools(context).map(toOpenAiToolDefinition);
  const messages: LlmAgentChatMessage[] = [
    ...(req.history ?? []),
    { role: 'user', content: req.userMessage },
  ];

  let steps = 0;
  let toolCallsUsed = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    steps += 1;
    const forceText = step === maxSteps - 1; // langkah terakhir: tanpa tools → ringkasan
    const activeTools = forceText ? [] : tools;

    // T-053h: mematikan tools saja TIDAK cukup. System prompt masih menyuruh memanggil
    // tool, jadi model yang kehilangan saluran protokol malah MENULIS pemanggilan tool ke
    // teks (markup DSML / "Memanggil nama_tool(...)") dan itu bocor ke pengguna. Saat tools
    // dimatikan, katakan terang-terangan bahwa tool tak tersedia lagi.
    const system = forceText ? `${req.system}\n\n${NO_TOOLS_INSTRUCTION}` : req.system;

    const response = await deps.llm.completeWithTools({
      tenantId: req.tenantId,
      jobId: req.jobId,
      task: req.task,
      system,
      messages,
      tools: activeTools,
      temperature: req.temperature,
      maxTokens,
    });
    if (!response.ok) return err(response.error);

    const outcome = response.value;
    if (outcome.kind === 'text') {
      return ok({ reply: outcome.content, steps, toolCallsUsed });
    }

    // outcome.kind === 'tool_calls'
    const results = await executeFunctionToolCalls(deps.tools, outcome.toolCalls, context);
    toolCallsUsed += outcome.toolCalls.length;
    messages.push({ role: 'assistant', content: '', toolCalls: outcome.toolCalls });
    for (const r of results) messages.push(r);

    if (forceText) {
      // Provider tetap mengeluarkan tool_calls walau tools=[] (jarang). Hentikan dgn
      // ringkasan NEEDS_INFO agar tidak loop tak terhingga.
      return ok({ reply: AGENT_MAX_STEPS_REPLY, steps, toolCallsUsed });
    }
  }

  // Pengaman (seharusnya tak tercapai karena langkah terakhir ditangani di atas).
  return ok({ reply: AGENT_MAX_STEPS_REPLY, steps, toolCallsUsed });
}
