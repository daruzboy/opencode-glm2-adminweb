// T-040 frontend slice: web chat widget controller for the portal.
// Transport is injected so the logic stays testable without a browser, React, or Vite.

export type ChatDirection = 'IN' | 'OUT';

export const CHAT_MESSAGE_MAX_LENGTH = 4000;

export interface PortalChatMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly direction: ChatDirection;
  readonly type: 'TEXT';
  readonly text: string | null;
  readonly mediaId: string | null;
  readonly providerMsgId: string;
  readonly status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  readonly createdAt: string;
}

export type ChatConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface ChatWidgetState {
  readonly tenantId: string;
  readonly conversationId?: string;
  readonly messages: readonly PortalChatMessage[];
  readonly status: ChatConnectionStatus;
  readonly error?: string;
}

export type ChatWidgetEvent =
  | {
      readonly type: 'history';
      readonly conversationId?: string;
      readonly messages: readonly PortalChatMessage[];
    }
  | {
      readonly type: 'reply';
      readonly conversationId: string;
      readonly message: PortalChatMessage;
    }
  | {
      readonly type: 'error';
      readonly message: string;
    };

export interface ChatSocket {
  send(data: string): void;
  close(): void;
}

export interface ChatTransport {
  fetchHistory(args: {
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<readonly PortalChatMessage[]>;
  connect(args: {
    readonly tenantId: string;
    readonly conversationId?: string;
    readonly onOpen: () => void;
    readonly onClose: () => void;
    readonly onEvent: (event: ChatWidgetEvent) => void;
    readonly onError: (message: string) => void;
  }): ChatSocket;
}

export interface ChatWidgetConfig {
  readonly tenantId: string;
  readonly conversationId?: string;
  readonly apiBaseUrl?: string;
  readonly wsBaseUrl?: string;
}

type Listener = (state: ChatWidgetState) => void;

export class ChatWidgetController {
  private state: ChatWidgetState;
  private socket: ChatSocket | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    config: ChatWidgetConfig,
    private readonly transport: ChatTransport = createBrowserChatTransport(config),
  ) {
    this.state = {
      tenantId: config.tenantId,
      conversationId: config.conversationId,
      messages: [],
      status: 'idle',
    };
  }

  snapshot(): ChatWidgetState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async loadHistory(conversationId: string = this.state.conversationId ?? ''): Promise<void> {
    if (conversationId.length === 0) return;
    try {
      const messages = await this.transport.fetchHistory({
        tenantId: this.state.tenantId,
        conversationId,
      });
      this.setState({
        conversationId,
        messages,
        error: undefined,
      });
    } catch (e) {
      this.setState({ status: 'error', error: errorMessage(e) });
    }
  }

  connect(): void {
    this.socket?.close();
    this.setState({ status: 'connecting', error: undefined });
    try {
      this.socket = this.transport.connect({
        tenantId: this.state.tenantId,
        conversationId: this.state.conversationId,
        onOpen: () => this.setState({ status: 'open', error: undefined }),
        onClose: () => this.setState({ status: 'closed' }),
        onError: (message) => this.setState({ status: 'error', error: message }),
        onEvent: (event) => this.applyServerEvent(event),
      });
    } catch (e) {
      this.socket = null;
      this.setState({ status: 'error', error: errorMessage(e) });
    }
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.setState({ status: 'closed' });
  }

  sendText(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
      this.setState({ status: 'error', error: `pesan maksimal ${CHAT_MESSAGE_MAX_LENGTH} karakter` });
      return false;
    }
    if (this.socket === null || this.state.status !== 'open') {
      this.setState({ status: 'error', error: 'chat belum terhubung' });
      return false;
    }

    this.socket.send(
      JSON.stringify({
        conversationId: this.state.conversationId,
        text: trimmed,
      }),
    );

    const conversationId = this.state.conversationId ?? 'pending';
    this.setState({
      messages: [
        ...this.state.messages,
        makeLocalIncomingMessage(this.state.tenantId, conversationId, trimmed),
      ],
    });
    return true;
  }

  private applyServerEvent(event: ChatWidgetEvent): void {
    if (event.type === 'error') {
      this.setState({ status: 'error', error: event.message });
      return;
    }

    if (event.type === 'history') {
      this.setState({
        conversationId: event.conversationId ?? this.state.conversationId,
        messages: event.messages,
        error: undefined,
      });
      return;
    }

    this.setState({
      conversationId: event.conversationId,
      messages: normalizePendingMessages([
        ...this.state.messages,
        { ...event.message, conversationId: event.conversationId },
      ], event.conversationId),
      error: undefined,
    });
  }

  private setState(patch: Partial<ChatWidgetState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

interface RuntimeSocket {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

interface RuntimeSocketCtor {
  new (url: string): RuntimeSocket;
}

interface RuntimeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type RuntimeFetch = (
  input: string,
  init?: { readonly headers?: Record<string, string> },
) => Promise<RuntimeResponse>;

interface BrowserTransportRuntime {
  readonly fetch?: RuntimeFetch;
  readonly WebSocket?: RuntimeSocketCtor;
  readonly location?: {
    readonly protocol: string;
    readonly host: string;
  };
}

export function createBrowserChatTransport(
  config: ChatWidgetConfig,
  runtime: BrowserTransportRuntime = globalThis as BrowserTransportRuntime,
): ChatTransport {
  const apiBaseUrl = normalizeBaseUrl(config.apiBaseUrl ?? '');
  const wsBaseUrl = resolveWebSocketBaseUrl(config.wsBaseUrl, runtime.location);

  return {
    async fetchHistory(args) {
      if (!runtime.fetch) throw new Error('fetch tidak tersedia');
      const url = `${apiBaseUrl}/api/chat/${encodeURIComponent(args.conversationId)}/messages`;
      const response = await runtime.fetch(url, {
        headers: { 'x-tenant-id': args.tenantId },
      });
      if (!response.ok) throw new Error(`gagal memuat riwayat chat (${response.status})`);
      return parseMessageArray(await response.json());
    },
    connect(args) {
      if (!runtime.WebSocket) throw new Error('WebSocket tidak tersedia');
      const params = new URLSearchParams({ tenantId: args.tenantId });
      if (args.conversationId) params.set('conversationId', args.conversationId);
      const socket = new runtime.WebSocket(`${wsBaseUrl}/api/chat?${params.toString()}`);
      socket.onopen = args.onOpen;
      socket.onclose = args.onClose;
      socket.onerror = () => args.onError('koneksi chat bermasalah');
      socket.onmessage = (event) => {
        const parsed = parseServerEvent(event.data);
        if (parsed.type === 'error') args.onError(parsed.message);
        args.onEvent(parsed);
      };
      return socket;
    },
  };
}

export function parseServerEvent(data: unknown): ChatWidgetEvent {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return { type: 'error', message: 'payload chat tidak valid' };
    }
    if (parsed.type === 'history') {
      return {
        type: 'history',
        conversationId: stringOrUndefined(parsed.conversationId),
        messages: parseMessageArray(parsed.messages),
      };
    }
    if (parsed.type === 'reply' && typeof parsed.conversationId === 'string') {
      const message = parseMessage(parsed.message);
      if (message) return { type: 'reply', conversationId: parsed.conversationId, message };
    }
    if (parsed.type === 'error' && typeof parsed.message === 'string') {
      return { type: 'error', message: parsed.message };
    }
    return { type: 'error', message: 'payload chat tidak valid' };
  } catch {
    return { type: 'error', message: 'payload chat tidak valid' };
  }
}

function parseMessageArray(value: unknown): readonly PortalChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const message = parseMessage(item);
    return message ? [message] : [];
  });
}

function parseMessage(value: unknown): PortalChatMessage | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.tenantId !== 'string' ||
    typeof value.conversationId !== 'string' ||
    !isDirection(value.direction) ||
    value.type !== 'TEXT' ||
    typeof value.providerMsgId !== 'string' ||
    !isStatus(value.status) ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    tenantId: value.tenantId,
    conversationId: value.conversationId,
    direction: value.direction,
    type: 'TEXT',
    text: typeof value.text === 'string' ? value.text : null,
    mediaId: typeof value.mediaId === 'string' ? value.mediaId : null,
    providerMsgId: value.providerMsgId,
    status: value.status,
    createdAt: value.createdAt,
  };
}

function normalizePendingMessages(
  messages: readonly PortalChatMessage[],
  conversationId: string,
): readonly PortalChatMessage[] {
  return messages.map((message) =>
    message.conversationId === 'pending' ? { ...message, conversationId } : message,
  );
}

function makeLocalIncomingMessage(
  tenantId: string,
  conversationId: string,
  text: string,
): PortalChatMessage {
  const createdAt = new Date().toISOString();
  return {
    id: `local-${createdAt}`,
    tenantId,
    conversationId,
    direction: 'IN',
    type: 'TEXT',
    text,
    mediaId: null,
    providerMsgId: `local-${createdAt}`,
    status: 'DELIVERED',
    createdAt,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveWebSocketBaseUrl(
  configured: string | undefined,
  location: BrowserTransportRuntime['location'],
): string {
  if (configured !== undefined && configured.length > 0) return normalizeBaseUrl(configured);
  if (!location) return '';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDirection(value: unknown): value is ChatDirection {
  return value === 'IN' || value === 'OUT';
}

function isStatus(value: unknown): value is PortalChatMessage['status'] {
  return (
    value === 'QUEUED' ||
    value === 'SENT' ||
    value === 'DELIVERED' ||
    value === 'READ' ||
    value === 'FAILED'
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
