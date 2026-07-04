import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatWidgetController,
  createBrowserChatTransport,
  parseServerEvent,
  type ChatSocket,
  type ChatTransport,
  type ChatWidgetEvent,
  type PortalChatMessage,
} from './chat-widget.js';

function message(overrides: Partial<PortalChatMessage> = {}): PortalChatMessage {
  return {
    id: 'm1',
    tenantId: 'tA',
    conversationId: 'c1',
    direction: 'OUT',
    type: 'TEXT',
    text: 'Halo dari bot',
    mediaId: null,
    providerMsgId: 'web-out-1',
    status: 'SENT',
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

function makeTransport(): {
  readonly transport: ChatTransport;
  readonly socket: ChatSocket & { readonly sent: string[] };
  emit(event: ChatWidgetEvent): void;
  open(): void;
  close(): void;
} {
  let onEvent: (event: ChatWidgetEvent) => void = () => undefined;
  let onOpen: () => void = () => undefined;
  let onClose: () => void = () => undefined;
  const socket = {
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close: vi.fn(() => onClose()),
  };
  return {
    socket,
    transport: {
      fetchHistory: vi.fn().mockResolvedValue([message({ id: 'm-history' })]),
      connect: vi.fn((args) => {
        onEvent = args.onEvent;
        onOpen = args.onOpen;
        onClose = args.onClose;
        return socket;
      }),
    },
    emit(event) {
      onEvent(event);
    },
    open() {
      onOpen();
    },
    close() {
      onClose();
    },
  };
}

describe('ChatWidgetController', () => {
  it('loads REST history with tenant and conversation scope', async () => {
    const f = makeTransport();
    const controller = new ChatWidgetController(
      { tenantId: 'tA', conversationId: 'c1' },
      f.transport,
    );

    await controller.loadHistory();

    expect(f.transport.fetchHistory).toHaveBeenCalledWith({ tenantId: 'tA', conversationId: 'c1' });
    expect(controller.snapshot().messages.map((m) => m.id)).toEqual(['m-history']);
  });

  it('connects websocket and sends backend-compatible inbound payload', () => {
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA', conversationId: 'c1' }, f.transport);

    controller.connect();
    f.open();
    const sent = controller.sendText('  hai  ');

    expect(sent).toBe(true);
    expect(controller.snapshot().status).toBe('open');
    expect(JSON.parse(f.socket.sent[0] ?? '{}')).toEqual({ conversationId: 'c1', text: 'hai' });
    expect(controller.snapshot().messages.at(-1)?.direction).toBe('IN');
  });

  it('applies reply event and normalizes pending optimistic conversation id', () => {
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA' }, f.transport);

    controller.connect();
    f.open();
    controller.sendText('halo');
    f.emit({ type: 'reply', conversationId: 'c-new', message: message({ conversationId: 'c-new' }) });

    expect(controller.snapshot().conversationId).toBe('c-new');
    expect(controller.snapshot().messages.map((m) => m.conversationId)).toEqual(['c-new', 'c-new']);
  });

  it('turns transport connection failure into error state instead of throwing', () => {
    const transport: ChatTransport = {
      fetchHistory: vi.fn().mockResolvedValue([]),
      connect: vi.fn(() => {
        throw new Error('WebSocket tidak tersedia');
      }),
    };
    const controller = new ChatWidgetController({ tenantId: 'tA' }, transport);

    expect(() => controller.connect()).not.toThrow();
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      error: 'WebSocket tidak tersedia',
    });
  });

  it('rejects text longer than backend schema limit', () => {
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA', conversationId: 'c1' }, f.transport);

    controller.connect();
    f.open();
    const sent = controller.sendText('x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1));

    expect(sent).toBe(false);
    expect(f.socket.sent).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      error: `pesan maksimal ${CHAT_MESSAGE_MAX_LENGTH} karakter`,
    });
  });

  it('keeps invalid server payload as a user-visible error state', () => {
    expect(parseServerEvent('{')).toEqual({
      type: 'error',
      message: 'payload chat tidak valid',
    });
  });

  it('assigns unique ids to optimistic local messages', () => {
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA', conversationId: 'c1' }, f.transport);

    controller.connect();
    f.open();
    controller.sendText('a');
    controller.sendText('b');

    const ids = controller.snapshot().messages.map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reconnects with backoff after an unexpected close', async () => {
    vi.useFakeTimers();
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA', conversationId: 'c1' }, f.transport);

    controller.connect();
    f.open();
    expect(controller.snapshot().status).toBe('open');

    f.close();
    expect(controller.snapshot().status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1000);
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    f.open();
    expect(controller.snapshot().status).toBe('open');
    vi.useRealTimers();
  });

  it('does not reconnect after an explicit disconnect', async () => {
    vi.useFakeTimers();
    const f = makeTransport();
    const controller = new ChatWidgetController({ tenantId: 'tA' }, f.transport);

    controller.connect();
    f.open();
    controller.disconnect();
    f.close();

    expect(controller.snapshot().status).toBe('closed');
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.transport.connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('gives up reconnecting after max attempts', async () => {
    vi.useFakeTimers();
    const f = makeTransport();
    const controller = new ChatWidgetController(
      { tenantId: 'tA', conversationId: 'c1', maxReconnectAttempts: 1 },
      f.transport,
    );

    controller.connect();
    f.open();
    f.close();
    await vi.advanceTimersByTimeAsync(1000);

    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    f.close();
    await vi.advanceTimersByTimeAsync(30000);

    expect(controller.snapshot().status).toBe('error');
    vi.useRealTimers();
  });
});

describe('createBrowserChatTransport', () => {
  it('fetches history from REST route with x-tenant-id header', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([message()]),
    });
    const transport = createBrowserChatTransport(
      { tenantId: 'tA', apiBaseUrl: 'https://api.test/' },
      { fetch },
    );

    const history = await transport.fetchHistory({ tenantId: 'tA', conversationId: 'c1' });

    expect(fetch).toHaveBeenCalledWith('https://api.test/api/chat/c1/messages', {
      headers: { 'x-tenant-id': 'tA' },
    });
    expect(history).toHaveLength(1);
  });

  it('derives same-origin websocket url from browser location when wsBaseUrl is absent', () => {
    const createdUrls: string[] = [];
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { readonly data: unknown }) => void) | null = null;

      constructor(url: string) {
        createdUrls.push(url);
      }

      send(): void {
        return undefined;
      }

      close(): void {
        return undefined;
      }
    }
    const transport = createBrowserChatTransport(
      { tenantId: 'tA' },
      {
        WebSocket: FakeWebSocket,
        location: { protocol: 'https:', host: 'portal.test' },
      },
    );

    transport.connect({
      tenantId: 'tA',
      conversationId: 'c1',
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
    });

    expect(createdUrls).toEqual(['wss://portal.test/api/chat?tenantId=tA&conversationId=c1']);
  });
});
