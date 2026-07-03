import { describe, expect, it, vi } from 'vitest';
import { CHAT_MESSAGE_MAX_LENGTH } from './chat-widget.js';
import { ChatWidgetPresenter } from './chat-widget-presenter.js';
import type { ChatWidgetSession } from './chat-widget-session.js';
import type { ChatWidgetViewModel } from './chat-widget-view-model.js';

function view(overrides: Partial<ChatWidgetViewModel> = {}): ChatWidgetViewModel {
  return {
    title: 'Chat digimaestro',
    subtitle: 'Percakapan baru',
    statusLabel: 'Online',
    canSend: true,
    messages: [],
    emptyLabel: 'Mulai ceritakan kebutuhan website kamu.',
    ...overrides,
  };
}

function makeSession(initial: ChatWidgetViewModel = view()): {
  readonly session: ChatWidgetSession;
  setView(next: ChatWidgetViewModel): void;
  readonly submit: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  let listener: ((view: ChatWidgetViewModel) => void) | null = null;
  const submit = vi.fn(() => true);
  return {
    submit,
    session: {
      controller: {} as ChatWidgetSession['controller'],
      snapshot: vi.fn(() => current),
      subscribe: vi.fn((fn) => {
        listener = fn;
        fn(current);
        return () => {
          listener = null;
        };
      }),
      start: vi.fn().mockResolvedValue(undefined),
      submit,
      stop: vi.fn(),
    },
    setView(next) {
      current = next;
      listener?.(current);
    },
  };
}

describe('ChatWidgetPresenter', () => {
  it('adds form copy and disables submit when draft is empty', () => {
    const f = makeSession();
    const presenter = new ChatWidgetPresenter(f.session);

    expect(presenter.snapshot()).toMatchObject({
      inputPlaceholder: 'Tulis pesan...',
      submitLabel: 'Kirim',
      draft: '',
      canSubmit: false,
    });
  });

  it('enables submit only when session can send and draft has text', () => {
    const f = makeSession(view({ canSend: true }));
    const presenter = new ChatWidgetPresenter(f.session);

    presenter.updateDraft('  halo  ');

    expect(presenter.snapshot().canSubmit).toBe(true);
    f.setView(view({ canSend: false }));
    expect(presenter.snapshot().canSubmit).toBe(false);
  });

  it('shows character helper and disables submit when draft exceeds backend limit', () => {
    const f = makeSession(view({ canSend: true }));
    const presenter = new ChatWidgetPresenter(f.session);

    presenter.updateDraft('x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1));

    expect(presenter.snapshot()).toMatchObject({
      canSubmit: false,
      helperLabel: `Pesan maksimal ${CHAT_MESSAGE_MAX_LENGTH} karakter (${CHAT_MESSAGE_MAX_LENGTH + 1}/${CHAT_MESSAGE_MAX_LENGTH})`,
    });
  });

  it('submits trimmed text and clears draft after successful send', () => {
    const f = makeSession();
    const presenter = new ChatWidgetPresenter(f.session);

    presenter.updateDraft('  bikin website  ');
    const sent = presenter.submit();

    expect(sent).toBe(true);
    expect(f.submit).toHaveBeenCalledWith('bikin website');
    expect(presenter.snapshot().draft).toBe('');
  });

  it('does not submit blank draft', () => {
    const f = makeSession();
    const presenter = new ChatWidgetPresenter(f.session);

    presenter.updateDraft('   ');

    expect(presenter.submit()).toBe(false);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('unsubscribes from session when last listener is removed', () => {
    const f = makeSession();
    const presenter = new ChatWidgetPresenter(f.session);
    const listener = vi.fn();

    const unsubscribe = presenter.subscribe(listener);
    unsubscribe();
    f.setView(view({ statusLabel: 'Terputus' }));

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
