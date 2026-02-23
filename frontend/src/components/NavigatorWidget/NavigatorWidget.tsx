import * as React from 'react';
import { useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import { Button, Label, Spinner, TextArea, Title } from '@patternfly/react-core';
import { TimesIcon, PaperPlaneIcon, CommentIcon, TrashIcon } from '@patternfly/react-icons';
import useNavigatorChat, { getPageContext } from './useNavigatorChat';
import './NavigatorWidget.scss';

const QUICK_ACTIONS = [
  'How do I create a workbench?',
  'How do I deploy a model?',
  'Tell me about Gen AI features',
];

const STORAGE_KEY = 'rhoai-navigator-chat';

type NavigatorErrorBoundaryState = { hasError: boolean };

class NavigatorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  NavigatorErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): NavigatorErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('NavigatorWidget crashed, clearing stored state:', error);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const NavigatorWidgetInner: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  const pageContext = getPageContext(pathname);
  const { messages, isLoading, sendMessage, clearChat } = useNavigatorChat();

  // Auto-scroll to bottom on new messages
  React.useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  const handleSend = React.useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) {
      return;
    }
    sendMessage(trimmed, pageContext);
    setInputValue('');
  }, [inputValue, isLoading, sendMessage, pageContext]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleQuickAction = React.useCallback(
    (prompt: string) => {
      sendMessage(prompt, pageContext);
    },
    [sendMessage, pageContext],
  );

  const lastMessage = messages.at(-1);
  const showLoading = isLoading && lastMessage?.role === 'assistant' && !lastMessage.content;

  return (
    <div className="navigator-widget">
      {isOpen && (
        <div className="navigator-widget__panel">
          <div className="navigator-widget__header">
            <div className="navigator-widget__header-title-group">
              <Title headingLevel="h3" size="md">
                Navigator
              </Title>
              <Label isCompact>{pageContext}</Label>
            </div>
            <Button
              variant="plain"
              aria-label="Clear chat"
              icon={<TrashIcon />}
              onClick={clearChat}
            />
          </div>

          <div className="navigator-widget__messages">
            {messages.length === 0 ? (
              <div className="navigator-widget__welcome">
                <Title headingLevel="h4" size="lg">
                  Welcome to Navigator
                </Title>
                <p>Ask me anything about OpenShift AI. I can help you get started.</p>
                <div className="navigator-widget__quick-actions">
                  {QUICK_ACTIONS.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="secondary"
                      isBlock
                      onClick={() => handleQuickAction(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={`${msg.role}-${msg.timestamp}-${index}`}
                  className={`navigator-widget__message navigator-widget__message--${msg.role}`}
                >
                  {msg.role === 'assistant' ? (
                    <Markdown>{msg.content}</Markdown>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              ))
            )}
            {showLoading && (
              <div className="navigator-widget__loading">
                <Spinner size="md" />
                <span>Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="navigator-widget__footer">
            <TextArea
              className="navigator-widget__input"
              value={inputValue}
              onChange={(_event, value) => setInputValue(value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Navigator..."
              aria-label="Chat input"
              rows={1}
              resizeOrientation="vertical"
              autoFocus
            />
            <Button
              variant="primary"
              aria-label="Send message"
              icon={<PaperPlaneIcon />}
              onClick={handleSend}
              isDisabled={!inputValue.trim() || isLoading}
            />
          </div>
        </div>
      )}

      <Button
        className="navigator-widget__toggle"
        variant="primary"
        aria-label={isOpen ? 'Close Navigator' : 'Open Navigator'}
        icon={isOpen ? <TimesIcon /> : <CommentIcon />}
        onClick={() => setIsOpen((prev) => !prev)}
      />
    </div>
  );
};

const NavigatorWidget: React.FC = () => (
  <NavigatorErrorBoundary>
    <NavigatorWidgetInner />
  </NavigatorErrorBoundary>
);

export default NavigatorWidget;
