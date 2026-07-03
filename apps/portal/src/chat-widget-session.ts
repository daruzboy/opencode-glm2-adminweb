import {
  ChatWidgetController,
  createBrowserChatTransport,
  type ChatTransport,
  type ChatWidgetConfig,
  type ChatWidgetState,
} from './chat-widget.js';
import {
  toChatWidgetViewModel,
  type ChatWidgetViewModel,
} from './chat-widget-view-model.js';

const DEFAULT_CONVERSATION_KEY_PREFIX = 'digimaestro.chat.conversation';

export interface ChatWidgetStorage {
  readConversationId(tenantId: string): string | undefined;
  writeConversationId(tenantId: string, conversationId: string): void;
}

export interface ChatWidgetSessionOptions extends ChatWidgetConfig {
  readonly transport?: ChatTransport;
  readonly storage?: ChatWidgetStorage;
}

export interface ChatWidgetSession {
  readonly controller: ChatWidgetController;
  snapshot(): ChatWidgetViewModel;
  subscribe(listener: (view: ChatWidgetViewModel) => void): () => void;
  start(): Promise<void>;
  submit(text: string): boolean;
  stop(): void;
}

export function createChatWidgetSession(options: ChatWidgetSessionOptions): ChatWidgetSession {
  const storage = options.storage;
  const conversationId =
    options.conversationId ?? readStoredConversationId(storage, options.tenantId);
  const config: ChatWidgetConfig = {
    tenantId: options.tenantId,
    conversationId,
    apiBaseUrl: options.apiBaseUrl,
    wsBaseUrl: options.wsBaseUrl,
  };
  const controller = new ChatWidgetController(
    config,
    options.transport ?? createBrowserChatTransport(config),
  );

  let stopped = false;
  const unsubscribePersist = controller.subscribe((state) => {
    persistConversationId(storage, state);
  });

  return {
    controller,
    snapshot() {
      return toChatWidgetViewModel(controller.snapshot());
    },
    subscribe(listener) {
      return controller.subscribe((state) => listener(toChatWidgetViewModel(state)));
    },
    async start() {
      await controller.loadHistory();
      controller.connect();
    },
    submit(text) {
      return controller.sendText(text);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribePersist();
      controller.disconnect();
    },
  };
}

interface RuntimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createBrowserChatWidgetStorage(
  storage: RuntimeStorage | undefined = (globalThis as { localStorage?: RuntimeStorage })
    .localStorage,
  keyPrefix: string = DEFAULT_CONVERSATION_KEY_PREFIX,
): ChatWidgetStorage {
  return {
    readConversationId(tenantId) {
      try {
        return storage?.getItem(key(tenantId, keyPrefix)) ?? undefined;
      } catch {
        return undefined;
      }
    },
    writeConversationId(tenantId, conversationId) {
      try {
        storage?.setItem(key(tenantId, keyPrefix), conversationId);
      } catch {
        return undefined;
      }
    },
  };
}

function readStoredConversationId(
  storage: ChatWidgetStorage | undefined,
  tenantId: string,
): string | undefined {
  try {
    return storage?.readConversationId(tenantId);
  } catch {
    return undefined;
  }
}

function persistConversationId(
  storage: ChatWidgetStorage | undefined,
  state: ChatWidgetState,
): void {
  if (!state.conversationId) return;
  try {
    storage?.writeConversationId(state.tenantId, state.conversationId);
  } catch {
    return undefined;
  }
}

function key(tenantId: string, prefix: string): string {
  return `${prefix}.${tenantId}`;
}
