import * as React from 'react';
import type { ChatMessage, NavigatorChatState } from './types';

const STORAGE_KEY = 'rhoai-navigator-chat';

const createInitialState = (): NavigatorChatState => ({
  conversation_id: '', // eslint-disable-line camelcase
  messages: [],
});

const loadState = (): NavigatorChatState => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return JSON.parse(raw) as NavigatorChatState;
    }
  } catch {
    // silently ignore sessionStorage errors
  }
  return createInitialState();
};

const saveState = (state: NavigatorChatState): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // silently ignore quota exceeded or unavailable errors
  }
};

type UseNavigatorStorage = {
  messages: ChatMessage[];
  conversationId: string;
  addMessage: (message: ChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  updateConversationId: (id: string) => void;
  clearChat: () => void;
};

const useNavigatorStorage = (): UseNavigatorStorage => {
  const [state, setState] = React.useState<NavigatorChatState>(loadState);

  React.useEffect(() => {
    saveState(state);
  }, [state]);

  const addMessage = React.useCallback((message: ChatMessage) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, message],
    }));
  }, []);

  const updateLastAssistantMessage = React.useCallback((content: string) => {
    setState((prev) => {
      const { messages } = prev;
      if (messages.length === 0) {
        return prev;
      }
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role !== 'assistant') {
        return prev;
      }
      const updated = [...messages];
      updated[updated.length - 1] = { ...lastMessage, content };
      return { ...prev, messages: updated };
    });
  }, []);

  const updateConversationId = React.useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      conversation_id: id, // eslint-disable-line camelcase
    }));
  }, []);

  const clearChat = React.useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // silently ignore
    }
    setState(createInitialState());
  }, []);

  return {
    messages: state.messages,
    conversationId: state.conversation_id,
    addMessage,
    updateLastAssistantMessage,
    updateConversationId,
    clearChat,
  };
};

export default useNavigatorStorage;
