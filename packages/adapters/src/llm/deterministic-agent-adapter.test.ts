import { describe, expect, it } from 'vitest';
import { tenantId, type LlmAgentPort, type LlmAgentResponse } from '@digimaestro/shared';
import {
  DeterministicLlmAgentAdapter,
  createDeterministicLlmAgentAdapter,
} from './deterministic-agent-adapter.js';

const tenant = tenantId('tA');

function baseRequest() {
  return {
    tenantId: tenant,
    task: 'interview' as const,
    system: 'sys',
    messages: [{ role: 'user' as const, content: 'hai' }],
    tools: [],
    maxTokens: 64,
  };
}

describe('DeterministicLlmAgentAdapter', () => {
  it('mengembalikan keluaran responder (text) sebagai Result.ok', async () => {
    const adapter = createDeterministicLlmAgentAdapter({
      responder: () => ({ kind: 'text', content: 'jawaban deterministik' }),
    });

    const r = await adapter.completeWithTools(baseRequest());

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual<LlmAgentResponse>({ kind: 'text', content: 'jawaban deterministik' });
  });

  it('mengembalikan keluaran tool_calls dari responder', async () => {
    const adapter = createDeterministicLlmAgentAdapter({
      responder: () => ({
        kind: 'tool_calls',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      }),
    });

    const r = await adapter.completeWithTools(baseRequest());

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe('tool_calls');
  });

  it('menerima argumen step (jumlah pesan tool + 1) ke responder', async () => {
    const seen: number[] = [];
    const adapter = createDeterministicLlmAgentAdapter({
      responder: (_req, step) => {
        seen.push(step);
        return { kind: 'text', content: String(step) };
      },
    });

    await adapter.completeWithTools({
      ...baseRequest(),
      messages: [
        { role: 'user', content: 'hai' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
        { role: 'tool', toolCallId: 'c1', name: 'x', content: '{}' },
      ],
    });

    expect(seen[0]).toBe(2); // 1 pesan role 'tool' → step 2
  });

  it('menangkap throw responder sebagai Result.err (code UNKNOWN)', async () => {
    const adapter = new DeterministicLlmAgentAdapter({
      responder: () => {
        throw new Error('boom');
      },
    });

    const r = await adapter.completeWithTools(baseRequest());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNKNOWN');
    expect(r.error.message).toBe('boom');
  });

  it('name mencerminkan provider kustom bila diberikan', () => {
    const adapter = createDeterministicLlmAgentAdapter({
      provider: 'glm',
      responder: () => ({ kind: 'text', content: '' }),
    });
    expect(adapter.name).toBe('llm-agent:glm');
  });

  it('kompatibel struktur dengan LlmAgentPort (LSP)', async () => {
    const adapter: LlmAgentPort = createDeterministicLlmAgentAdapter({
      responder: () => ({ kind: 'text', content: 'ok' }),
    });
    const r = await adapter.completeWithTools(baseRequest());
    expect(r.ok).toBe(true);
  });
});
