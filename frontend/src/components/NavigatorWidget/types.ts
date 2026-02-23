export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp: number;
};

export type NavigatorChatState = {
  conversation_id: string;
  messages: ChatMessage[];
};

export type ChatRequest = {
  message: string;
  page_context?: string;
  conversation_id?: string;
};

export type ChatResponse = {
  response: string;
  conversation_id: string;
  referenced_documents?: string[];
};

export type PageContextEntry = {
  pattern: string;
  name: string;
};
