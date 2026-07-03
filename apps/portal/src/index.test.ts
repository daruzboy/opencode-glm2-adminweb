import { describe, it, expect } from 'vitest';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatWidgetPresenter,
  createBrowserChatWidgetPresenter,
  createPortal,
  destroyBrowserChatWidgetMounts,
  mountAllBrowserChatWidgets,
  mountBrowserChatWidget,
  mountBrowserChatWidgetFromDataset,
  parseServerEvent,
  toChatWidgetViewModel,
} from './index.js';

describe('portal', () => {
  it('defaults to Bahasa Indonesia', () => {
    expect(createPortal().locale).toBe('id');
  });

  it('exports public web chat widget API from package entrypoint', () => {
    expect(typeof parseServerEvent).toBe('function');
    expect(typeof toChatWidgetViewModel).toBe('function');
    expect(typeof createBrowserChatWidgetPresenter).toBe('function');
    expect(typeof destroyBrowserChatWidgetMounts).toBe('function');
    expect(typeof mountAllBrowserChatWidgets).toBe('function');
    expect(typeof mountBrowserChatWidget).toBe('function');
    expect(typeof mountBrowserChatWidgetFromDataset).toBe('function');
    expect(CHAT_MESSAGE_MAX_LENGTH).toBe(4000);
    expect(ChatWidgetPresenter).toBeDefined();
  });
});
