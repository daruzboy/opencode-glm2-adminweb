import type {
  ChatConnectionStatus,
  ChatWidgetState,
  PortalChatMessage,
} from './chat-widget.js';

export interface ChatMessageView {
  readonly id: string;
  readonly text: string;
  readonly align: 'start' | 'end';
  readonly tone: 'client' | 'bot';
  readonly timeLabel: string;
  readonly dateTime: string;
}

export interface ChatWidgetViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly status: ChatConnectionStatus;
  readonly statusLabel: string;
  readonly canSend: boolean;
  readonly messages: readonly ChatMessageView[];
  readonly emptyLabel?: string;
  readonly errorLabel?: string;
}

export function toChatWidgetViewModel(state: ChatWidgetState): ChatWidgetViewModel {
  const messages = state.messages.map(toMessageView);
  return {
    title: 'Chat digimaestro',
    subtitle: state.conversationId ? `Percakapan ${state.conversationId}` : 'Percakapan baru',
    status: state.status,
    statusLabel: statusLabel(state.status),
    canSend: state.status === 'open',
    messages,
    emptyLabel: messages.length === 0 ? 'Mulai ceritakan kebutuhan website kamu.' : undefined,
    errorLabel: state.error,
  };
}

function toMessageView(message: PortalChatMessage): ChatMessageView {
  return {
    id: message.id,
    text: message.text ?? '',
    align: message.direction === 'IN' ? 'end' : 'start',
    tone: message.direction === 'IN' ? 'client' : 'bot',
    timeLabel: formatTime(message.createdAt),
    dateTime: message.createdAt,
  };
}

function statusLabel(status: ChatWidgetState['status']): string {
  switch (status) {
    case 'idle':
      return 'Siap dihubungkan';
    case 'connecting':
      return 'Menghubungkan...';
    case 'open':
      return 'Online';
    case 'closed':
      return 'Terputus';
    case 'error':
      return 'Perlu dicek';
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(date);
}
