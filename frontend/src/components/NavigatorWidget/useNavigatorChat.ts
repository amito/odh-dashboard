import * as React from 'react';
import useNavigatorStorage from './useNavigatorStorage';
import type { ChatMessage, PageContextEntry } from './types';

const PAGE_CONTEXT_ENTRIES: PageContextEntry[] = [
  { pattern: '/projects', name: 'Data Science Projects' },
  { pattern: '/modelServing', name: 'Model Serving' },
  { pattern: '/pipelines', name: 'Pipelines' },
  { pattern: '/notebookController', name: 'Workbenches' },
  { pattern: '/explore', name: 'Catalog' },
  { pattern: '/settings', name: 'Settings' },
  { pattern: '/home', name: 'Home' },
];

export const getPageContext = (pathname: string): string => {
  const entry = PAGE_CONTEXT_ENTRIES.find((e) => pathname.startsWith(e.pattern));
  return entry?.name ?? 'Dashboard';
};

type UseNavigatorChat = {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (message: string, pageContext: string) => void;
  clearChat: () => void;
};

const useNavigatorChat = (): UseNavigatorChat => {
  const {
    messages,
    conversationId,
    addMessage,
    updateLastAssistantMessage,
    updateConversationId,
    clearChat,
  } = useNavigatorStorage();

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const sendMessage = React.useCallback(
    (message: string, pageContext: string) => {
      if (isLoading) {
        return;
      }

      setError(null);
      setIsLoading(true);

      addMessage({ role: 'user', content: message, timestamp: Date.now() });
      addMessage({ role: 'assistant', content: '', timestamp: Date.now() });

      // Abort any previous in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetch('/api/navigator/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          page_context: pageContext, // eslint-disable-line camelcase
          conversation_id: conversationId, // eslint-disable-line camelcase
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorData: { error?: string } = await response
              .json()
              .catch(() => ({ error: 'Request failed' }));
            throw new Error(errorData.error ?? `Request failed: ${response.status}`);
          }

          if (!response.body) {
            throw new Error('No response body received');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';
          let sseBuffer = '';

          // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) {
                continue;
              }
              try {
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                const parsed = JSON.parse(line.slice(6)) as {
                  event: string;
                  token?: string;
                  conversation_id?: string;
                  error?: string;
                };
                if (parsed.event === 'token' && parsed.token != null) {
                  accumulated += parsed.token;
                  updateLastAssistantMessage(accumulated);
                } else if (parsed.event === 'start' && parsed.conversation_id) {
                  updateConversationId(parsed.conversation_id);
                } else if (parsed.event === 'error') {
                  throw new Error(parsed.error || 'Streaming error');
                }
              } catch (e) {
                if (e instanceof Error && e.message !== 'Streaming error') {
                  // Skip JSON parse errors
                  continue;
                }
                throw e;
              }
            }
          }

          if (!accumulated) {
            updateLastAssistantMessage('I received an empty response. Please try again.');
          }
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') {
            return;
          }

          const errorMessage = err.message || 'An unknown error occurred';
          setError(errorMessage);
          updateLastAssistantMessage(`Sorry, I encountered an error: ${errorMessage}`);
        })
        .finally(() => {
          setIsLoading(false);
          abortControllerRef.current = null;
        });
    },
    [isLoading, addMessage, updateLastAssistantMessage, updateConversationId, conversationId],
  );

  // Cleanup on unmount: abort any in-flight request
  React.useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  return { messages, isLoading, error, sendMessage, clearChat };
};

export default useNavigatorChat;
