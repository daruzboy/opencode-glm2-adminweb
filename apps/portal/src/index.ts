// apps/portal — React 19 + Vite 6 (portal klien + dashboard admin). PRD §4.1, SRS §2.
// Vite/React/Tailwind/shadcn dipasang saat EPIC-04 (web chat) & EPIC-08 (admin). Untuk T-010 skeleton.

export const PORTAL_NAME = 'digimaestro-portal';

export interface PortalConfig {
  readonly name: string;
  readonly locale: 'id' | 'en';
}

export function createPortal(name: string = PORTAL_NAME): PortalConfig {
  return { name, locale: 'id' };
}

export {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatWidgetController,
  createBrowserChatTransport,
  parseServerEvent,
  type ChatConnectionStatus,
  type ChatDirection,
  type ChatSocket,
  type ChatTransport,
  type ChatWidgetConfig,
  type ChatWidgetEvent,
  type ChatWidgetState,
  type PortalChatMessage,
} from './chat-widget.js';

export {
  toChatWidgetViewModel,
  type ChatMessageView,
  type ChatWidgetViewModel,
} from './chat-widget-view-model.js';

export {
  createBrowserChatWidgetStorage,
  createChatWidgetSession,
  type ChatWidgetSession,
  type ChatWidgetSessionOptions,
  type ChatWidgetStorage,
} from './chat-widget-session.js';

export {
  ChatWidgetPresenter,
  createBrowserChatWidgetPresenter,
  createChatWidgetPresenter,
  type ChatWidgetPresenterView,
} from './chat-widget-presenter.js';

export {
  destroyBrowserChatWidgetMounts,
  mountAllBrowserChatWidgets,
  mountBrowserChatWidget,
  mountBrowserChatWidgetFromDataset,
  type ChatDomButtonElement,
  type ChatDomDatasetElement,
  type ChatDomDocument,
  type ChatDomElement,
  type ChatDomEvent,
  type ChatDomInputElement,
  type ChatDomRootDocument,
  type ChatWidgetDomMount,
  type ChatWidgetDomOptions,
} from './chat-widget-dom.js';
