/**
 * Chat Component for chat.sudharsana.dev
 * Handles message display and SSE streaming
 */

import type { FC } from "react";

interface User {
  id: string;
  email: string;
  name: string | null;
}

interface Session {
  id: string;
  title: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatProps {
  user: User;
  sessions: Session[];
  currentSessionId?: string;
  messages?: Message[];
}

// Sidebar Component
const Sidebar: FC<{ user: User; sessions: Session[]; currentSessionId?: string }> = ({
  user,
  sessions,
  currentSessionId,
}) => {
  return (
    <div className="w-64 bg-dark-900 border-r border-dark-800 flex flex-col">
      {/* New Chat Button */}
      <div className="p-4 border-b border-dark-800">
        <button
          id="new-chat-btn"
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {sessions.map((session) => (
          <a
            key={session.id}
            href={`/chat/${session.id}`}
            className={`block p-3 rounded-lg mb-1 truncate transition ${
              session.id === currentSessionId
                ? "bg-dark-800 text-white"
                : "text-dark-200 hover:bg-dark-800"
            }`}
          >
            {session.title}
          </a>
        ))}
      </div>

      {/* User Info */}
      <div className="p-4 border-t border-dark-800">
        <div className="flex items-center justify-between">
          <span className="text-sm text-dark-200 truncate">{user.name || user.email}</span>
          <a href="/logout" className="text-dark-200 hover:text-white transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
};

// Message Component
const MessageBubble: FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
          isUser ? "bg-blue-600" : "bg-green-600"
        }`}
      >
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={`max-w-[70%] bg-dark-800 rounded-2xl px-4 py-3 ${
          isUser ? "rounded-tr-none" : "rounded-tl-none"
        }`}
      >
        <div className="message-content whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
};

// Typing Indicator
const TypingIndicator: FC = () => {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-bold">
        AI
      </div>
      <div className="bg-dark-800 rounded-2xl rounded-tl-none px-4 py-3">
        <div className="typing-indicator flex gap-1">
          <span className="w-2 h-2 bg-dark-200 rounded-full" />
          <span className="w-2 h-2 bg-dark-200 rounded-full" />
          <span className="w-2 h-2 bg-dark-200 rounded-full" />
        </div>
      </div>
    </div>
  );
};

// Empty State
const EmptyState: FC = () => {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-dark-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-dark-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">Welcome to Chat</h2>
        <p className="text-dark-200">Start a new conversation or select one from the sidebar.</p>
      </div>
    </div>
  );
};

// Chat Input
const ChatInput: FC<{ sessionId: string }> = ({ sessionId }) => {
  return (
    <div className="p-4 border-t border-dark-800">
      <form id="chat-form" className="flex gap-4">
        <input type="hidden" id="session-id" value={sessionId} />
        <textarea
          id="message-input"
          placeholder="Type your message..."
          rows={1}
          className="flex-1 px-4 py-3 bg-dark-800 border border-dark-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
          Send
        </button>
      </form>
    </div>
  );
};

// Main Chat Component
export const Chat: FC<ChatProps> = ({ user, sessions, currentSessionId, messages = [] }) => {
  return (
    <div className="flex h-screen">
      <Sidebar user={user} sessions={sessions} currentSessionId={currentSessionId} />

      <div className="flex-1 flex flex-col">
        {/* Messages Area */}
        <div id="messages" className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {!currentSessionId ? (
            <EmptyState />
          ) : (
            <>
              <div id="message-container" className="space-y-6">
                {messages.map((msg, idx) => (
                  <MessageBubble key={idx} message={msg} />
                ))}
              </div>
              <div id="typing-indicator" className="hidden">
                <TypingIndicator />
              </div>
            </>
          )}
        </div>

        {/* Input Area */}
        {currentSessionId && <ChatInput sessionId={currentSessionId} />}
      </div>

      {/* Client-side JavaScript for SSE */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            const sessionId = document.getElementById('session-id')?.value;
            const messageContainer = document.getElementById('message-container');
            const typingIndicator = document.getElementById('typing-indicator');
            const messagesDiv = document.getElementById('messages');

            function appendMessage(role, content) {
              const isUser = role === 'user';
              const html = \`
                <div class="flex items-start gap-3 \${isUser ? 'flex-row-reverse' : ''}">
                  <div class="w-8 h-8 rounded-full \${isUser ? 'bg-blue-600' : 'bg-green-600'} flex items-center justify-center text-sm font-bold flex-shrink-0">
                    \${isUser ? 'You' : 'AI'}
                  </div>
                  <div class="max-w-[70%] bg-dark-800 rounded-2xl \${isUser ? 'rounded-tr-none' : 'rounded-tl-none'} px-4 py-3">
                    <div class="message-content whitespace-pre-wrap">\${escapeHtml(content)}</div>
                  </div>
                </div>
              \`;
              messageContainer.insertAdjacentHTML('beforeend', html);
            }

            function escapeHtml(text) {
              const div = document.createElement('div');
              div.textContent = text;
              return div.innerHTML;
            }

            function scrollToBottom() {
              messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            // Handle Enter key
            document.getElementById('message-input')?.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('chat-form').dispatchEvent(new Event('submit'));
              }
            });

            // Handle form submit
            document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
              e.preventDefault();

              const input = document.getElementById('message-input');
              const message = input.value.trim();
              if (!message) return;

              appendMessage('user', message);
              input.value = '';
              scrollToBottom();

              typingIndicator.classList.remove('hidden');
              scrollToBottom();

              try {
                const response = await fetch('/api/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId, message })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                typingIndicator.classList.add('hidden');

                const assistantDiv = document.createElement('div');
                assistantDiv.className = 'flex items-start gap-3';
                assistantDiv.innerHTML = \`
                  <div class="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-bold flex-shrink-0">AI</div>
                  <div class="max-w-[70%] bg-dark-800 rounded-2xl rounded-tl-none px-4 py-3">
                    <div class="message-content whitespace-pre-wrap"></div>
                  </div>
                \`;
                messageContainer.appendChild(assistantDiv);
                const contentDiv = assistantDiv.querySelector('.message-content');

                let fullContent = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  const text = decoder.decode(value);
                  const lines = text.split('\\n');

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                          fullContent += data.content;
                          contentDiv.textContent = fullContent;
                          scrollToBottom();
                        }
                      } catch {}
                    }
                  }
                }
              } catch (err) {
                typingIndicator.classList.add('hidden');
                console.error('Chat error:', err);
              }
            });

            // New chat button
            document.getElementById('new-chat-btn')?.addEventListener('click', async () => {
              const res = await fetch('/api/sessions', { method: 'POST' });
              const { sessionId } = await res.json();
              window.location.href = '/chat/' + sessionId;
            });
          `,
        }}
      />
    </div>
  );
};

export default Chat;
