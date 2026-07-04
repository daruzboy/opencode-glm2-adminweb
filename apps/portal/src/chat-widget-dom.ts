import {
  createBrowserChatWidgetPresenter,
  type ChatWidgetPresenter,
  type ChatWidgetPresenterView,
} from './chat-widget-presenter.js';
import type { ChatWidgetSessionOptions } from './chat-widget-session.js';

export interface ChatDomEvent {
  preventDefault(): void;
}

export interface ChatDomElement {
  className: string;
  textContent: string | null;
  append(...nodes: ChatDomElement[]): void;
  replaceChildren(...nodes: ChatDomElement[]): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event: ChatDomEvent) => void): void;
}

export interface ChatDomInputElement extends ChatDomElement {
  value: string;
  disabled: boolean;
  placeholder: string;
}

export interface ChatDomButtonElement extends ChatDomElement {
  disabled: boolean;
  type: string;
}

export interface ChatDomDocument {
  createElement(tagName: string): ChatDomElement;
}

export interface ChatDomRootDocument extends ChatDomDocument {
  querySelectorAll(selector: string): readonly ChatDomDatasetElement[];
}

export interface ChatWidgetDomMount {
  readonly presenter: ChatWidgetPresenter;
  destroy(): void;
}

export interface ChatWidgetDomOptions extends ChatWidgetSessionOptions {
  readonly document?: ChatDomDocument;
}

const mountedRoots = new WeakMap<ChatDomElement, ChatWidgetDomMount>();

export interface ChatDomDatasetElement extends ChatDomElement {
  readonly dataset?: {
    readonly tenantId?: string;
    readonly conversationId?: string;
    readonly apiBaseUrl?: string;
    readonly wsBaseUrl?: string;
  };
}

export function mountBrowserChatWidget(
  root: ChatDomElement,
  options: ChatWidgetDomOptions,
): ChatWidgetDomMount {
  const existing = mountedRoots.get(root);
  if (existing) return existing;

  const document = options.document ?? browserDocument();
  const presenter = createBrowserChatWidgetPresenter(options);
  const frame = buildFrame(document, presenter);
  root.replaceChildren(frame.container);
  const unsubscribe = presenter.subscribe((view) => renderFrame(frame, view));
  void presenter.start();

  let destroyed = false;
  const mount: ChatWidgetDomMount = {
    presenter,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      presenter.stop();
      mountedRoots.delete(root);
      root.replaceChildren();
    },
  };
  mountedRoots.set(root, mount);
  return mount;
}

export function mountBrowserChatWidgetFromDataset(
  root: ChatDomDatasetElement,
  options: Partial<ChatWidgetDomOptions> = {},
): ChatWidgetDomMount {
  const tenantId = options.tenantId ?? root.dataset?.tenantId;
  if (!tenantId || tenantId.length === 0) {
    throw new Error('tenantId wajib diisi untuk chat widget');
  }

  return mountBrowserChatWidget(root, {
    ...options,
    tenantId,
    conversationId: options.conversationId ?? root.dataset?.conversationId,
    apiBaseUrl: options.apiBaseUrl ?? root.dataset?.apiBaseUrl,
    wsBaseUrl: options.wsBaseUrl ?? root.dataset?.wsBaseUrl,
  });
}

export function mountAllBrowserChatWidgets(
  options: Partial<ChatWidgetDomOptions> & {
    readonly document?: ChatDomRootDocument;
    readonly selector?: string;
    readonly onMountError?: (root: ChatDomDatasetElement, error: Error) => void;
  } = {},
): readonly ChatWidgetDomMount[] {
  const document = options.document ?? browserRootDocument();
  const selector = options.selector ?? '[data-digimaestro-chat]';
  return document.querySelectorAll(selector).flatMap((root) => {
    try {
      return [mountBrowserChatWidgetFromDataset(root, { ...options, document })];
    } catch (e) {
      options.onMountError?.(root, toError(e));
      return [];
    }
  });
}

export function destroyBrowserChatWidgetMounts(mounts: readonly ChatWidgetDomMount[]): void {
  for (const mount of mounts) {
    mount.destroy();
  }
}

interface WidgetFrame {
  readonly container: ChatDomElement;
  readonly title: ChatDomElement;
  readonly subtitle: ChatDomElement;
  readonly status: ChatDomElement;
  readonly messages: ChatDomElement;
  readonly error: ChatDomElement;
  readonly input: ChatDomInputElement;
  readonly helper: ChatDomElement;
  readonly submit: ChatDomButtonElement;
}

function buildFrame(document: ChatDomDocument, presenter: ChatWidgetPresenter): WidgetFrame {
  const container = element(document, 'section', 'dm-chat-widget');
  container.setAttribute('aria-label', 'Chat digimaestro');

  const header = element(document, 'header', 'dm-chat-widget__header');
  const title = element(document, 'h2', 'dm-chat-widget__title');
  const subtitle = element(document, 'p', 'dm-chat-widget__subtitle');
  const status = element(document, 'span', 'dm-chat-widget__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  header.append(title, subtitle, status);

  const messages = element(document, 'div', 'dm-chat-widget__messages');
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-live', 'polite');

  const error = element(document, 'p', 'dm-chat-widget__error');
  error.setAttribute('role', 'alert');
  const form = element(document, 'form', 'dm-chat-widget__form');
  form.setAttribute('aria-label', 'Kirim pesan chat');
  const input = inputElement(document, 'dm-chat-widget__input');
  const helper = element(document, 'span', 'dm-chat-widget__helper');
  helper.setAttribute('aria-live', 'polite');
  const submit = buttonElement(document, 'dm-chat-widget__submit');
  form.append(input, helper, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    presenter.submit();
  });
  input.addEventListener('input', () => {
    presenter.updateDraft(input.value);
  });

  container.append(header, messages, error, form);
  return { container, title, subtitle, status, messages, error, input, helper, submit };
}

function renderFrame(frame: WidgetFrame, view: ChatWidgetPresenterView): void {
  frame.title.textContent = view.title;
  frame.subtitle.textContent = view.subtitle;
  frame.status.textContent = view.statusLabel;
  frame.error.textContent = view.errorLabel ?? '';
  frame.container.setAttribute('data-status', view.status);
  frame.messages.setAttribute('aria-busy', view.statusLabel === 'Menghubungkan...' ? 'true' : 'false');
  frame.input.value = view.draft;
  frame.input.placeholder = view.inputPlaceholder;
  frame.input.disabled = !view.canSend;
  frame.helper.textContent = view.helperLabel;
  frame.submit.textContent = view.submitLabel;
  frame.submit.disabled = !view.canSubmit;

  if (view.messages.length === 0) {
    const empty = elementFrom(frame.messages, 'p', 'dm-chat-widget__empty');
    empty.textContent = view.emptyLabel ?? '';
    frame.messages.replaceChildren(empty);
    return;
  }

  frame.messages.replaceChildren(
    ...view.messages.map((message) => {
      const item = elementFrom(
        frame.messages,
        'article',
        `dm-chat-widget__message dm-chat-widget__message--${message.tone}`,
      );
      item.setAttribute('data-align', message.align);
      item.setAttribute('data-tone', message.tone);
      item.setAttribute('aria-label', message.tone === 'client' ? 'Pesan kamu' : 'Pesan bot');
      const text = elementFrom(frame.messages, 'p', 'dm-chat-widget__message-text');
      const time = elementFrom(frame.messages, 'time', 'dm-chat-widget__message-time');
      text.textContent = message.text;
      time.textContent = message.timeLabel;
      time.setAttribute('datetime', message.dateTime);
      item.append(text, time);
      return item;
    }),
  );
}

function element(document: ChatDomDocument, tagName: string, className: string): ChatDomElement {
  const node = document.createElement(tagName);
  node.className = className;
  return node;
}

function inputElement(document: ChatDomDocument, className: string): ChatDomInputElement {
  const node = document.createElement('input') as ChatDomInputElement;
  node.className = className;
  node.setAttribute('name', 'message');
  node.setAttribute('autocomplete', 'off');
  node.setAttribute('aria-label', 'Pesan');
  node.setAttribute('maxlength', '4000');
  return node;
}

function buttonElement(document: ChatDomDocument, className: string): ChatDomButtonElement {
  const node = document.createElement('button') as ChatDomButtonElement;
  node.className = className;
  node.type = 'submit';
  node.setAttribute('aria-label', 'Kirim pesan');
  return node;
}

function elementFrom(anchor: ChatDomElement, tagName: string, className: string): ChatDomElement {
  const owner = findOwnerDocument(anchor);
  return element(owner, tagName, className);
}

function findOwnerDocument(anchor: ChatDomElement): ChatDomDocument {
  const maybe = anchor as ChatDomElement & { readonly ownerDocument?: ChatDomDocument };
  if (maybe.ownerDocument) return maybe.ownerDocument;
  throw new Error('ownerDocument tidak tersedia pada adapter DOM');
}

function browserDocument(): ChatDomDocument {
  const runtime = globalThis as { readonly document?: ChatDomDocument };
  if (!runtime.document) throw new Error('document tidak tersedia');
  return runtime.document;
}

function browserRootDocument(): ChatDomRootDocument {
  const runtime = globalThis as { readonly document?: ChatDomRootDocument };
  if (!runtime.document) throw new Error('document tidak tersedia');
  return runtime.document;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
