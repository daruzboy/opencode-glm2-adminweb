import { describe, expect, it, vi } from 'vitest';
import type {
  ChatDomDocument,
  ChatDomElement,
  ChatDomEvent,
  ChatDomInputElement,
} from './chat-widget-dom.js';
import {
  destroyBrowserChatWidgetMounts,
  mountAllBrowserChatWidgets,
  mountBrowserChatWidget,
  mountBrowserChatWidgetFromDataset,
} from './chat-widget-dom.js';
import type { ChatTransport, ChatWidgetEvent, PortalChatMessage } from './chat-widget.js';

class FakeElement implements ChatDomInputElement {
  className = '';
  textContent: string | null = null;
  value = '';
  disabled = false;
  placeholder = '';
  type = '';
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, (event: ChatDomEvent) => void>();
  readonly dataset: Record<string, string | undefined> = {};

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  append(...nodes: ChatDomElement[]): void {
    this.children.push(...nodes.map((node) => node as FakeElement));
  }

  replaceChildren(...nodes: ChatDomElement[]): void {
    this.children.splice(0, this.children.length, ...nodes.map((node) => node as FakeElement));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: (event: ChatDomEvent) => void): void {
    this.listeners.set(type, listener);
  }

  emit(type: string): void {
    this.listeners.get(type)?.({ preventDefault: vi.fn() });
  }

  findByClass(className: string): FakeElement | undefined {
    if (this.className.split(' ').includes(className)) return this;
    for (const child of this.children) {
      const found = child.findByClass(className);
      if (found) return found;
    }
    return undefined;
  }
}

class FakeDocument implements ChatDomDocument {
  readonly roots: FakeElement[] = [];

  createElement(tagName: string): ChatDomElement {
    return new FakeElement(tagName, this);
  }

  querySelectorAll(_selector: string): readonly FakeElement[] {
    return this.roots;
  }
}

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
  readonly close: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
  emit(event: ChatWidgetEvent): void;
} {
  let onEvent: (event: ChatWidgetEvent) => void = () => undefined;
  const close = vi.fn();
  const send = vi.fn();
  return {
    close,
    send,
    transport: {
      fetchHistory: vi.fn().mockResolvedValue([message()]),
      connect: vi.fn((args) => {
        onEvent = args.onEvent;
        args.onOpen();
        return { send, close };
      }),
    },
    emit(event) {
      onEvent(event);
    },
  };
}

describe('mountBrowserChatWidget', () => {
  it('renders widget shell, wires input events, and destroys cleanly', async () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);
    const f = makeTransport();

    const mount = mountBrowserChatWidget(root, {
      tenantId: 'tA',
      conversationId: 'c1',
      document,
      transport: f.transport,
    });
    await widgetSettled();

    expect(root.findByClass('dm-chat-widget__title')?.textContent).toBe('Chat digimaestro');
    expect(root.findByClass('dm-chat-widget__status')?.textContent).toBe('Online');
    expect(root.findByClass('dm-chat-widget')?.attributes.get('data-status')).toBe('open');
    expect(root.findByClass('dm-chat-widget__status')?.attributes.get('role')).toBe('status');
    expect(root.findByClass('dm-chat-widget__error')?.attributes.get('role')).toBe('alert');
    expect(root.findByClass('dm-chat-widget__helper')?.textContent).toBe('0/4000');
    const renderedMessage = root.findByClass('dm-chat-widget__message');
    expect(renderedMessage?.attributes.get('data-tone')).toBe('bot');
    expect(renderedMessage?.attributes.get('aria-label')).toBe('Pesan bot');
    expect(renderedMessage?.findByClass('dm-chat-widget__message-time')?.attributes.get('datetime')).toBe(
      '2026-07-04T01:30:00.000Z',
    );

    const input = root.findByClass('dm-chat-widget__input');
    const submit = root.findByClass('dm-chat-widget__submit');
    const helper = root.findByClass('dm-chat-widget__helper');
    expect(input).toBeDefined();
    expect(submit).toBeDefined();

    if (input && submit) {
      expect(input.attributes.get('aria-label')).toBe('Pesan');
      expect(input.attributes.get('maxlength')).toBe('4000');
      expect(submit.attributes.get('aria-label')).toBe('Kirim pesan');
      input.value = 'buat website';
      input.emit('input');
      expect(submit.disabled).toBe(false);
      expect(helper?.textContent).toBe('12/4000');
      input.value = 'x'.repeat(4001);
      input.emit('input');
      expect(submit.disabled).toBe(true);
      expect(helper?.textContent).toBe('Pesan maksimal 4000 karakter (4001/4000)');
      input.value = 'buat website';
      input.emit('input');
      root.findByClass('dm-chat-widget__form')?.emit('submit');
      expect(JSON.parse(String(f.send.mock.calls[0]?.[0] ?? '{}'))).toEqual({
        conversationId: 'c1',
        text: 'buat website',
      });
      expect(input.value).toBe('');
    }

    mount.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('is idempotent per root and allows remount after destroy', () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);
    const f = makeTransport();

    const first = mountBrowserChatWidget(root, {
      tenantId: 'tA',
      document,
      transport: f.transport,
    });
    const second = mountBrowserChatWidget(root, {
      tenantId: 'tA',
      document,
      transport: f.transport,
    });

    expect(second).toBe(first);
    expect(root.children).toHaveLength(1);

    first.destroy();
    const third = mountBrowserChatWidget(root, {
      tenantId: 'tA',
      document,
      transport: f.transport,
    });

    expect(third).not.toBe(first);
    expect(root.children).toHaveLength(1);
  });

  it('destroys only once when cleanup is called repeatedly', async () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);
    const f = makeTransport();
    const mount = mountBrowserChatWidget(root, {
      tenantId: 'tA',
      document,
      transport: f.transport,
    });
    await widgetSettled();

    mount.destroy();
    mount.destroy();

    expect(f.close).toHaveBeenCalledTimes(1);
    expect(root.children).toHaveLength(0);
  });
});

describe('mountBrowserChatWidgetFromDataset', () => {
  it('reads tenant and conversation config from root dataset', async () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);
    const f = makeTransport();
    root.dataset.tenantId = 'tA';
    root.dataset.conversationId = 'c1';

    mountBrowserChatWidgetFromDataset(root, {
      document,
      transport: f.transport,
    });
    await widgetSettled();

    expect(f.transport.fetchHistory).toHaveBeenCalledWith({
      tenantId: 'tA',
      conversationId: 'c1',
    });
    expect(f.transport.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tA',
        conversationId: 'c1',
      }),
    );
  });

  it('fails fast when tenant id is missing', () => {
    const document = new FakeDocument();
    const root = new FakeElement('div', document);

    expect(() => mountBrowserChatWidgetFromDataset(root, { document })).toThrow(
      'tenantId wajib diisi',
    );
  });
});

describe('mountAllBrowserChatWidgets', () => {
  it('mounts every valid dataset root and skips invalid roots', async () => {
    const document = new FakeDocument();
    const validA = new FakeElement('div', document);
    const validB = new FakeElement('div', document);
    const invalid = new FakeElement('div', document);
    const f = makeTransport();
    validA.dataset.tenantId = 'tA';
    validB.dataset.tenantId = 'tB';
    document.roots.push(validA, invalid, validB);

    const mounts = mountAllBrowserChatWidgets({
      document,
      transport: f.transport,
    });
    await widgetSettled();

    expect(mounts).toHaveLength(2);
    expect(validA.findByClass('dm-chat-widget')).toBeDefined();
    expect(validB.findByClass('dm-chat-widget')).toBeDefined();
    expect(invalid.findByClass('dm-chat-widget')).toBeUndefined();
  });

  it('reports invalid root through onMountError callback', () => {
    const document = new FakeDocument();
    const invalid = new FakeElement('div', document);
    const onMountError = vi.fn();
    document.roots.push(invalid);

    const mounts = mountAllBrowserChatWidgets({
      document,
      onMountError,
    });

    expect(mounts).toHaveLength(0);
    expect(onMountError).toHaveBeenCalledWith(invalid, expect.any(Error));
  });

  it('destroys auto-mounted widgets as a group', async () => {
    const document = new FakeDocument();
    const validA = new FakeElement('div', document);
    const validB = new FakeElement('div', document);
    const f = makeTransport();
    validA.dataset.tenantId = 'tA';
    validB.dataset.tenantId = 'tB';
    document.roots.push(validA, validB);

    const mounts = mountAllBrowserChatWidgets({
      document,
      transport: f.transport,
    });
    await widgetSettled();

    destroyBrowserChatWidgetMounts(mounts);
    destroyBrowserChatWidgetMounts(mounts);

    expect(validA.children).toHaveLength(0);
    expect(validB.children).toHaveLength(0);
    expect(f.close).toHaveBeenCalledTimes(2);
  });
});

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function widgetSettled(): Promise<void> {
  await nextTick();
  await nextTick();
}
