import { describe, expect, it, vi } from 'vitest';
import {
  err,
  ok,
  tenantId,
  type AgentToolDefinition,
  type LlmAgentPort,
  type LlmAgentRequest,
  type LlmAgentResponse,
  type Result,
} from '@digimaestro/shared';
import { NO_TOOLS_INSTRUCTION,
  AGENT_MAX_STEPS_REPLY,
  DEFAULT_AGENT_MAX_STEPS,
  runAgentLoop,
} from './agent-loop.js';

const tenant = tenantId('tA');

// Fake LlmAgentPort: responder(request, step) menentukan keluaran. `step` di sini =
// jumlah pesan role 'tool' di riwayat + 1 (mencerminkan posisi panggilan dalam loop).
function fakeAgentPort(responder: (request: LlmAgentRequest) => LlmAgentResponse): LlmAgentPort {
  return {
    name: 'llm-agent:fake',
    async completeWithTools(request): Promise<Result<LlmAgentResponse, never>> {
      return ok(responder(request));
    },
  };
}

function recordingTool(name: string, scope: 'ops' | 'sitebuilder' = 'ops'): {
  tool: AgentToolDefinition<unknown, unknown>;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn().mockResolvedValue(ok({ done: true, name }));
  return {
    execute,
    tool: {
      name,
      description: `tool test ${name}`,
      scope,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute,
    },
  };
}

describe('runAgentLoop', () => {
  it('mengembalikan teks langsung saat LLM menjawab tanpa tool (1 step)', async () => {
    const llm = fakeAgentPort(() => ({ kind: 'text', content: 'halo balasan' }));

    const r = await runAgentLoop(
      { llm, tools: emptyRegistry() },
      { tenantId: tenant, actor: 'chatbot', scopes: [], task: 'interview', system: 'sys', userMessage: 'hai' },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reply).toBe('halo balasan');
    expect(r.value.steps).toBe(1);
    expect(r.value.toolCallsUsed).toBe(0);
  });

  it('menjalankan round-trip tool lalu menjawab teks pada step berikutnya', async () => {
    let calls = 0;
    const llm = fakeAgentPort((req) => {
      calls += 1;
      if (req.tools.length > 0 && calls === 1) {
        return {
          kind: 'tool_calls',
          toolCalls: [
            { id: 'call-1', type: 'function', function: { name: 'ops_get_job_status', arguments: '{"jobId":"j1"}' } },
          ],
        };
      }
      return { kind: 'text', content: 'status: selesai' };
    });
    const { tool, execute } = recordingTool('ops_get_job_status', 'ops');
    const registry = registryFrom([tool]);

    const r = await runAgentLoop(
      { llm, tools: registry },
      { tenantId: tenant, actor: 'chatbot', scopes: ['ops'], task: 'intent', system: 'sys', userMessage: 'gimana proses?' },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ jobId: 'j1' }, expect.objectContaining({ tenantId: tenant }));
    expect(r.value.reply).toBe('status: selesai');
    expect(r.value.steps).toBe(2);
    expect(r.value.toolCallsUsed).toBe(1);
  });

  it('menghentikan loop dgn NEEDS_INFO saat tool_calls terus-menerus hingga maxSteps', async () => {
    // Responder selalu memuntahkan tool_calls, bahkan saat tools=[] (langkah terakhir).
    const llm = fakeAgentPort(() => ({
      kind: 'tool_calls',
      toolCalls: [
        { id: 'c', type: 'function', function: { name: 'ops_get_job_status', arguments: '{}' } },
      ],
    }));
    const { tool } = recordingTool('ops_get_job_status', 'ops');
    const registry = registryFrom([tool]);

    const r = await runAgentLoop(
      { llm, tools: registry },
      {
        tenantId: tenant,
        actor: 'chatbot',
        scopes: ['ops'],
        task: 'intent',
        system: 'sys',
        userMessage: 'x',
        maxSteps: 2,
      },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reply).toBe(AGENT_MAX_STEPS_REPLY);
    expect(r.value.steps).toBe(2);
  });

  it('menyuntik tenantId ke eksekusi tool (NFR-09, scope guard)', async () => {
    const llm = fakeAgentPort((req) => {
      if (req.tools.length > 0) {
        return {
          kind: 'tool_calls',
          toolCalls: [
            { id: 'call-x', type: 'function', function: { name: 'ops_get_job_status', arguments: '{}' } },
          ],
        };
      }
      return { kind: 'text', content: 'ok' };
    });
    const { tool, execute } = recordingTool('ops_get_job_status', 'ops');
    const registry = registryFrom([tool]);

    await runAgentLoop(
      { llm, tools: registry },
      { tenantId: tenant, actor: 'bot', scopes: ['ops'], task: 'intent', system: 's', userMessage: 'a' },
    );

    expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: tenant }));
  });

  it('memaksa panggilan tanpa tools pada langkah terakhir (ringkasan teks)', async () => {
    const seenToolsLength: number[] = [];
    const llm = fakeAgentPort((req) => {
      seenToolsLength.push(req.tools.length);
      if (req.tools.length === 0) return { kind: 'text', content: 'ringkasan akhir' };
      return {
        kind: 'tool_calls',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'ops_get_job_status', arguments: '{}' } }],
      };
    });
    const { tool } = recordingTool('ops_get_job_status', 'ops');
    const registry = registryFrom([tool]);

    const r = await runAgentLoop(
      { llm, tools: registry },
      { tenantId: tenant, actor: 'bot', scopes: ['ops'], task: 'intent', system: 's', userMessage: 'a', maxSteps: 3 },
    );

    expect(r.ok).toBe(true);
    // langkah terakhir memakai tools=[] (length 0)
    expect(seenToolsLength.at(-1)).toBe(0);
  });

  it('propagasi error LlmAgentPort sebagai Result.err', async () => {
    const llm: LlmAgentPort = {
      name: 'llm-agent:failing',
      async completeWithTools() {
        return err({ code: 'HTTP', message: 'provider down', retryable: true, attempt: 1 });
      },
    };

    const r = await runAgentLoop(
      { llm, tools: emptyRegistry() },
      { tenantId: tenant, actor: 'bot', scopes: [], task: 'interview', system: 's', userMessage: 'a' },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('HTTP');
  });

  it('DEFAULT_AGENT_MAX_STEPS bernilai wajar (>= 2)', () => {
    expect(DEFAULT_AGENT_MAX_STEPS).toBeGreaterThanOrEqual(2);
  });
});

// ── helper registry kosong & dari daftar tool ─────────────────────────────────
import { createAgentToolRegistry } from './tool-registry.js';

function emptyRegistry() {
  return createAgentToolRegistry([]);
}
function registryFrom(tools: readonly AgentToolDefinition<unknown, unknown>[]) {
  return createAgentToolRegistry(tools);
}

// T-053h — AKAR bocoran markup: mematikan tools saja tak cukup. System prompt masih
// menyuruh memanggil tool, jadi model menuliskannya sebagai teks. Saat tools dimatikan,
// model HARUS diberi tahu.
describe('runAgentLoop — langkah terakhir (tools dimatikan)', () => {
  it('tools dikosongkan DAN system diberi instruksi "tool tidak tersedia"', async () => {
    const seen: { tools: unknown[]; system: string }[] = [];
    const llm = {
      completeWithTools: vi.fn(async (req: { tools: unknown[]; system: string }) => {
        seen.push({ tools: req.tools, system: req.system });
        // Selalu minta tool → memaksa loop sampai langkah terakhir (forceText).
        return seen.length < 2
          ? ok({
              kind: 'tool_calls' as const,
              toolCalls: [
                { id: 'c1', type: 'function' as const, function: { name: 'noop', arguments: '{}' } },
              ],
            })
          : ok({ kind: 'text' as const, content: 'ringkasan' });
      }),
    };

    await runAgentLoop(
      { llm, tools: createAgentToolRegistry([]) } as never,
      {
        tenantId: tenantId('t1'),
        actor: 'chatbot',
        scopes: [],
        task: 'chat_reply',
        system: 'Kamu asisten. Panggil tool bila perlu.',
        userMessage: 'bangun situs',
        maxSteps: 2,
      },
    );

    const last = seen[seen.length - 1];
    expect(last?.tools).toHaveLength(0);
    // Tanpa ini, model "memanggil tool" lewat teks dan markup-nya bocor ke pengguna.
    expect(last?.system).toContain(NO_TOOLS_INSTRUCTION);
    // Langkah sebelumnya TIDAK diberi instruksi itu (tools masih hidup).
    expect(seen[0]?.system).not.toContain(NO_TOOLS_INSTRUCTION);
  });
});
