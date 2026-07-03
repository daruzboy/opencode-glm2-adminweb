import { describe, expect, it } from 'vitest';
import type { ChatWidgetState, PortalChatMessage } from './chat-widget.js';
import { toChatWidgetViewModel } from './chat-widget-view-model.js';

function message(overrides: Partial<PortalChatMessage> = {}): PortalChatMessage {
  return {
    id: 'm1',
    tenantId: 'tA',
    conversationId: 'c1',
    direction: 'OUT',
    type: 'TEXT',
    text: 'Halo, ada yang bisa dibantu?',
    mediaId: null,
    providerMsgId: 'web-out-1',
    status: 'SENT',
    createdAt: '2026-07-04T01:30:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<ChatWidgetState> = {}): ChatWidgetState {
  return {
    tenantId: 'tA',
    conversationId: 'c1',
    messages: [],
    status: 'idle',
    ...overrides,
  };
}

describe('toChatWidgetViewModel', () => {
  it('maps empty idle state into Indonesian widget copy', () => {
    const vm = toChatWidgetViewModel(state({ conversationId: undefined }));

    expect(vm).toMatchObject({
      title: 'Chat digimaestro',
      subtitle: 'Percakapan baru',
      status: 'idle',
      statusLabel: 'Siap dihubungkan',
      canSend: false,
      emptyLabel: 'Mulai ceritakan kebutuhan website kamu.',
    });
  });

  it('enables sending only when websocket state is open', () => {
    expect(toChatWidgetViewModel(state({ status: 'open' })).canSend).toBe(true);
    expect(toChatWidgetViewModel(state({ status: 'connecting' })).canSend).toBe(false);
  });

  it('maps message direction into visual alignment and tone', () => {
    const vm = toChatWidgetViewModel(
      state({
        messages: [
          message({ id: 'bot', direction: 'OUT' }),
          message({ id: 'client', direction: 'IN', text: 'Saya mau bikin website' }),
        ],
      }),
    );

    expect(vm.messages.map((m) => [m.id, m.align, m.tone])).toEqual([
      ['bot', 'start', 'bot'],
      ['client', 'end', 'client'],
    ]);
    expect(vm.messages[0]?.dateTime).toBe('2026-07-04T01:30:00.000Z');
  });

  it('passes controller error through as presentation error label', () => {
    expect(toChatWidgetViewModel(state({ status: 'error', error: 'koneksi putus' })).errorLabel).toBe(
      'koneksi putus',
    );
  });
});
