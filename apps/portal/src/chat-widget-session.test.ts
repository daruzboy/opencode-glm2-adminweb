import { describe, expect, it, vi } from 'vitest';
import type {
  ChatSocket,
  ChatTransport,
  ChatWidgetEvent,
  PortalChatMessage,
} from './chat-widget.js';
import {
  createBrowserChatWidgetStorage,
  createChatWidgetSession,
  type ChatWidgetStorage,
} from './chat-widget-session.js';

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
    createdAt: '2026-07-04T01:30:00.000Z',
    ...overrides,
  };
}

function makeTransport(): {
  readonly transport: ChatTransport;
  readonly socket: ChatSocket & { readonly sent: string[] };
  emit(event: ChatWidgetEvent): void;
  open(): void;
} {
  let onEvent: (event: ChatWidgetEvent) => void = () => undefined;
  let onOpen: () => void = () => undefined;
  const socket = {
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close: vi.fn(),
  };
  return {
    socket,
    transport: {
      fetchHistory: vi.fn().mockResolvedValue([message({ id: 'from-history' })]),
      connect: vi.fn((args) => {
        onEvent = args.onEvent;
        onOpen = args.onOpen;
        return socket;
      }),
    },
    emit(event) {
      onEvent(event);
    },
    open() {
      onOpen();
    },
  };
}

function makeStorage(existing?: string): ChatWidgetStorage & {
  readonly writes: readonly string[];
} {
  const writes: string[] = [];
  return {
    writes,
    readConversationId: vi.fn(() => existing),
    writeConversationId: vi.fn((_tenantId, conversationId) => {
      writes.push(conversationId);
    }),
  };
}

describe('createChatWidgetSession', () => {
  it('uses stored conversation id, loads history, connects, and exposes view model', async () => {
    const f = makeTransport();
    const storage = makeStorage('c-stored');
    const session = createChatWidgetSession({
      tenantId: 'tA',
      transport: f.transport,
      storage,
    });

    await session.start();
    f.open();

    expect(f.transport.fetchHistory).toHaveBeenCalledWith({
      tenantId: 'tA',
      conversationId: 'c-stored',
    });
    expect(f.transport.connect).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tA', conversationId: 'c-stored' }),
    );
    expect(session.snapshot()).toMatchObject({
      subtitle: 'Percakapan c-stored',
      statusLabel: 'Online',
      canSend: true,
    });
  });

  it('submits text through controller and persists conversation id after first reply', async () => {
    const f = makeTransport();
    const storage = makeStorage();
    const session = createChatWidgetSession({ tenantId: 'tA', transport: f.transport, storage });

    await session.start();
    f.open();
    expect(session.submit(' bikin website ')).toBe(true);
    f.emit({ type: 'reply', conversationId: 'c-new', message: message({ conversationId: 'c-new' }) });

    expect(JSON.parse(f.socket.sent[0] ?? '{}')).toEqual({
      text: 'bikin website',
    });
    expect(storage.writes).toContain('c-new');
  });

  it('keeps chat usable when optional storage read/write throws', async () => {
    const f = makeTransport();
    const storage: ChatWidgetStorage = {
      readConversationId: vi.fn(() => {
        throw new Error('storage blocked');
      }),
      writeConversationId: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
    };

    const session = createChatWidgetSession({ tenantId: 'tA', transport: f.transport, storage });
    await session.start();
    f.open();
    f.emit({ type: 'reply', conversationId: 'c-new', message: message({ conversationId: 'c-new' }) });

    expect(session.snapshot()).toMatchObject({
      statusLabel: 'Online',
      subtitle: 'Percakapan c-new',
    });
  });

  it('stops only once and detaches persistence listener', async () => {
    const f = makeTransport();
    const storage = makeStorage();
    const session = createChatWidgetSession({ tenantId: 'tA', transport: f.transport, storage });

    await session.start();
    f.open();
    session.stop();
    session.stop();
    f.emit({ type: 'reply', conversationId: 'after-stop', message: message({ conversationId: 'after-stop' }) });

    expect(f.socket.close).toHaveBeenCalledTimes(1);
    expect(storage.writes).not.toContain('after-stop');
  });
});

describe('createBrowserChatWidgetStorage', () => {
  it('stores conversation id per tenant with deterministic key', () => {
    const values = new Map<string, string>();
    const storage = createBrowserChatWidgetStorage({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });

    storage.writeConversationId('tA', 'c1');

    expect(storage.readConversationId('tA')).toBe('c1');
    expect(storage.readConversationId('tB')).toBeUndefined();
  });

  it('treats browser storage failures as unavailable storage', () => {
    const storage = createBrowserChatWidgetStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    expect(storage.readConversationId('tA')).toBeUndefined();
    expect(() => storage.writeConversationId('tA', 'c1')).not.toThrow();
  });
});
