import { CHAT_MESSAGE_MAX_LENGTH } from './chat-widget.js';
import type { ChatWidgetSession } from './chat-widget-session.js';
import {
  createBrowserChatWidgetStorage,
  createChatWidgetSession,
  type ChatWidgetSessionOptions,
} from './chat-widget-session.js';
import type { ChatWidgetViewModel } from './chat-widget-view-model.js';

export interface ChatWidgetPresenterView extends ChatWidgetViewModel {
  readonly draft: string;
  readonly inputPlaceholder: string;
  readonly submitLabel: string;
  readonly canSubmit: boolean;
  readonly helperLabel: string;
}

type PresenterListener = (view: ChatWidgetPresenterView) => void;

export class ChatWidgetPresenter {
  private draft = '';
  private readonly listeners = new Set<PresenterListener>();
  private unsubscribeSession: (() => void) | null = null;

  constructor(private readonly session: ChatWidgetSession) {}

  snapshot(): ChatWidgetPresenterView {
    return this.toPresenterView(this.session.snapshot());
  }

  subscribe(listener: PresenterListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());

    if (this.unsubscribeSession === null) {
      this.unsubscribeSession = this.session.subscribe(() => this.emit());
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unsubscribeSession?.();
        this.unsubscribeSession = null;
      }
    };
  }

  updateDraft(value: string): void {
    this.draft = value;
    this.emit();
  }

  async start(): Promise<void> {
    await this.session.start();
  }

  submit(): boolean {
    const text = this.draft.trim();
    if (text.length === 0 || !this.session.snapshot().canSend) {
      this.emit();
      return false;
    }

    const sent = this.session.submit(text);
    if (sent) this.draft = '';
    this.emit();
    return sent;
  }

  stop(): void {
    this.session.stop();
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.listeners.clear();
  }

  private emit(): void {
    const view = this.snapshot();
    for (const listener of this.listeners) listener(view);
  }

  private toPresenterView(view: ChatWidgetViewModel): ChatWidgetPresenterView {
    const draftLength = this.draft.trim().length;
    const hasDraft = draftLength > 0;
    const isWithinLimit = draftLength <= CHAT_MESSAGE_MAX_LENGTH;
    return {
      ...view,
      draft: this.draft,
      inputPlaceholder: 'Tulis pesan...',
      submitLabel: 'Kirim',
      canSubmit: view.canSend && hasDraft && isWithinLimit,
      helperLabel: isWithinLimit
        ? `${draftLength}/${CHAT_MESSAGE_MAX_LENGTH}`
        : `Pesan maksimal ${CHAT_MESSAGE_MAX_LENGTH} karakter (${draftLength}/${CHAT_MESSAGE_MAX_LENGTH})`,
    };
  }
}

export function createChatWidgetPresenter(session: ChatWidgetSession): ChatWidgetPresenter {
  return new ChatWidgetPresenter(session);
}

export function createBrowserChatWidgetPresenter(
  options: ChatWidgetSessionOptions,
): ChatWidgetPresenter {
  const session = createChatWidgetSession({
    ...options,
    storage: options.storage ?? createBrowserChatWidgetStorage(),
  });
  return createChatWidgetPresenter(session);
}
