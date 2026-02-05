/**
 * Hono Server for chat.sudharsana.dev
 * High-performance chat application with SSE streaming
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";

import {
  sql,
  createSession,
  getSessionById,
  getUserSessions,
  updateSessionTitle,
  deleteSession,
  createMessage,
  getMessageContext,
  healthCheck,
  closeConnection,
  type User,
} from "./lib/db";

import {
  streamChat,
  generateTitle,
  checkOllamaHealth,
  type ChatMessage,
} from "./lib/ai";

import {
  signup,
  login,
  logout,
  validateToken,
  isApproved,
  extractTokenFromCookie,
  createAuthCookie,
  createLogoutCookie,
} from "./lib/auth";

// Types
type Variables = {
  user: User;
};

// Create Hono app
const app = new Hono<{ Variables: Variables }>();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["https://chat.sudharsana.dev", "http://localhost:3000"],
    credentials: true,
  })
);

// Serve static files
app.use("/static/*", serveStatic({ root: "./public" }));

// ============================================
// Auth Middleware
// ============================================

const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const token = extractTokenFromCookie(c.req.header("Cookie"));

  if (!token) {
    return c.redirect("/login");
  }

  const user = await validateToken(token);
  if (!user) {
    return c.redirect("/login");
  }

  // Check if user is approved (velvet rope)
  if (!isApproved(user)) {
    return c.html(renderPendingApproval(user.email), 403);
  }

  c.set("user", user);
  await next();
};

// ============================================
// HTML Rendering Functions
// ============================================

const renderLayout = (content: string, title = "Chat") => `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | chat.sudharsana.dev</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            dark: {
              50: '#f8fafc',
              100: '#f1f5f9',
              200: '#e2e8f0',
              700: '#334155',
              800: '#1e293b',
              900: '#0f172a',
              950: '#020617',
            }
          }
        }
      }
    }
  </script>
  <style>
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .typing-indicator span {
      animation: pulse-dot 1.4s infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    .message-content pre {
      background: #1e293b;
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
    }
    .message-content code {
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body class="bg-dark-950 text-dark-100 min-h-screen">
  ${content}
</body>
</html>
`;

const renderLogin = (error?: string) => renderLayout(`
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="bg-dark-900 rounded-2xl p-8 shadow-2xl border border-dark-800">
        <h1 class="text-3xl font-bold text-center mb-2">Welcome</h1>
        <p class="text-dark-200 text-center mb-8">Sign in to continue</p>

        ${error ? `<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6">${error}</div>` : ""}

        <form method="POST" action="/login" class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-dark-200 mb-2">Email</label>
            <input
              type="email"
              name="email"
              required
              class="w-full px-4 py-3 bg-dark-800 border border-dark-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-dark-200 mb-2">Password</label>
            <input
              type="password"
              name="password"
              required
              class="w-full px-4 py-3 bg-dark-800 border border-dark-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
          >
            Sign In
          </button>
        </form>

        <p class="text-center text-dark-200 mt-6">
          Don't have an account?
          <a href="/signup" class="text-blue-400 hover:text-blue-300">Sign up</a>
        </p>
      </div>
    </div>
  </div>
`, "Login");

const renderSignup = (error?: string) => renderLayout(`
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="bg-dark-900 rounded-2xl p-8 shadow-2xl border border-dark-800">
        <h1 class="text-3xl font-bold text-center mb-2">Create Account</h1>
        <p class="text-dark-200 text-center mb-8">Join the chat</p>

        ${error ? `<div class="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-6">${error}</div>` : ""}

        <form method="POST" action="/signup" class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-dark-200 mb-2">Name</label>
            <input
              type="text"
              name="name"
              class="w-full px-4 py-3 bg-dark-800 border border-dark-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="Your name"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-dark-200 mb-2">Email</label>
            <input
              type="email"
              name="email"
              required
              class="w-full px-4 py-3 bg-dark-800 border border-dark-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-dark-200 mb-2">Password</label>
            <input
              type="password"
              name="password"
              required
              minlength="8"
              class="w-full px-4 py-3 bg-dark-800 border border-dark-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition"
          >
            Create Account
          </button>
        </form>

        <p class="text-center text-dark-200 mt-6">
          Already have an account?
          <a href="/login" class="text-blue-400 hover:text-blue-300">Sign in</a>
        </p>
      </div>
    </div>
  </div>
`, "Sign Up");

const renderPendingApproval = (email: string) => renderLayout(`
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md text-center">
      <div class="bg-dark-900 rounded-2xl p-8 shadow-2xl border border-dark-800">
        <div class="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <h1 class="text-2xl font-bold mb-2">Pending Approval</h1>
        <p class="text-dark-200 mb-4">
          Your account (${email}) is awaiting approval.
        </p>
        <p class="text-dark-200 text-sm">
          You'll be notified once your account is approved.
        </p>
        <a href="/logout" class="inline-block mt-6 text-blue-400 hover:text-blue-300">
          Sign out
        </a>
      </div>
    </div>
  </div>
`, "Pending Approval");

const renderChat = (user: User, sessions: any[], currentSessionId?: string) => renderLayout(`
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-64 bg-dark-900 border-r border-dark-800 flex flex-col">
      <div class="p-4 border-b border-dark-800">
        <button
          onclick="createNewSession()"
          class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center justify-center gap-2"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
          </svg>
          New Chat
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        ${sessions
          .map(
            (s) => `
          <a
            href="/chat/${s.id}"
            class="block p-3 rounded-lg mb-1 truncate ${
              s.id === currentSessionId
                ? "bg-dark-800 text-white"
                : "text-dark-200 hover:bg-dark-800"
            }"
          >
            ${s.title}
          </a>
        `
          )
          .join("")}
      </div>

      <div class="p-4 border-t border-dark-800">
        <div class="flex items-center justify-between">
          <span class="text-sm text-dark-200 truncate">${user.name || user.email}</span>
          <a href="/logout" class="text-dark-200 hover:text-white">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
            </svg>
          </a>
        </div>
      </div>
    </div>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col">
      <!-- Messages -->
      <div id="messages" class="flex-1 overflow-y-auto p-6 space-y-6">
        ${!currentSessionId ? `
          <div class="h-full flex items-center justify-center">
            <div class="text-center">
              <h2 class="text-2xl font-bold mb-2">Welcome to Chat</h2>
              <p class="text-dark-200">Start a new conversation or select one from the sidebar.</p>
            </div>
          </div>
        ` : `
          <div id="message-container" class="space-y-6"></div>
          <div id="typing-indicator" class="hidden">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-sm font-bold">AI</div>
              <div class="bg-dark-800 rounded-2xl rounded-tl-none px-4 py-3">
                <div class="typing-indicator flex gap-1">
                  <span class="w-2 h-2 bg-dark-200 rounded-full"></span>
                  <span class="w-2 h-2 bg-dark-200 rounded-full"></span>
                  <span class="w-2 h-2 bg-dark-200 rounded-full"></span>
                </div>
              </div>
            </div>
          </div>
        `}
      </div>

      <!-- Input -->
      ${currentSessionId ? `
        <div class="p-4 border-t border-dark-800">
          <form id="chat-form" class="flex gap-4">
            <input type="hidden" id="session-id" value="${currentSessionId}" />
            <textarea
              id="message-input"
              placeholder="Type your message..."
              rows="1"
              class="flex-1 px-4 py-3 bg-dark-800 border border-dark-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none"
              onkeydown="handleKeyDown(event)"
            ></textarea>
            <button
              type="submit"
              class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex items-center gap-2"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
              </svg>
              Send
            </button>
          </form>
        </div>
      ` : ""}
    </div>
  </div>

  <script>
    const sessionId = document.getElementById('session-id')?.value;
    const messageContainer = document.getElementById('message-container');
    const typingIndicator = document.getElementById('typing-indicator');
    const messagesDiv = document.getElementById('messages');

    // Load existing messages
    if (sessionId) {
      loadMessages();
    }

    async function loadMessages() {
      const res = await fetch('/api/sessions/' + sessionId + '/messages');
      const messages = await res.json();
      messageContainer.innerHTML = '';
      messages.forEach(msg => appendMessage(msg.role, msg.content));
      scrollToBottom();
    }

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

    function handleKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('chat-form').dispatchEvent(new Event('submit'));
      }
    }

    document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const input = document.getElementById('message-input');
      const message = input.value.trim();
      if (!message) return;

      // Add user message
      appendMessage('user', message);
      input.value = '';
      scrollToBottom();

      // Show typing indicator
      typingIndicator.classList.remove('hidden');
      scrollToBottom();

      try {
        // Stream response
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Hide typing indicator and create assistant message
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

    async function createNewSession() {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const { sessionId } = await res.json();
      window.location.href = '/chat/' + sessionId;
    }
  </script>
`, "Chat");

// ============================================
// Public Routes
// ============================================

app.get("/", (c) => c.redirect("/chat"));

app.get("/login", (c) => c.html(renderLogin()));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = body.email as string;
  const password = body.password as string;

  const result = await login(email, password);

  if ("error" in result) {
    return c.html(renderLogin(result.error));
  }

  c.header("Set-Cookie", createAuthCookie(result.token));
  return c.redirect("/chat");
});

app.get("/signup", (c) => c.html(renderSignup()));

app.post("/signup", async (c) => {
  const body = await c.req.parseBody();
  const email = body.email as string;
  const password = body.password as string;
  const name = body.name as string | undefined;

  const result = await signup(email, password, name);

  if ("error" in result) {
    return c.html(renderSignup(result.error));
  }

  c.header("Set-Cookie", createAuthCookie(result.token));
  return c.redirect("/chat");
});

app.get("/logout", async (c) => {
  const token = extractTokenFromCookie(c.req.header("Cookie"));
  if (token) {
    await logout(token);
  }
  c.header("Set-Cookie", createLogoutCookie());
  return c.redirect("/login");
});

// ============================================
// Protected Routes
// ============================================

app.get("/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  const sessions = await getUserSessions(user.id);
  return c.html(renderChat(user, sessions));
});

app.get("/chat/:sessionId", authMiddleware, async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  const session = await getSessionById(sessionId);
  if (!session || session.user_id !== user.id) {
    return c.redirect("/chat");
  }

  const sessions = await getUserSessions(user.id);
  return c.html(renderChat(user, sessions, sessionId));
});

// ============================================
// API Routes
// ============================================

app.post("/api/sessions", authMiddleware, async (c) => {
  const user = c.get("user");
  const session = await createSession(user.id);
  return c.json({ sessionId: session.id });
});

app.get("/api/sessions/:sessionId/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  const session = await getSessionById(sessionId);
  if (!session || session.user_id !== user.id) {
    return c.json({ error: "Not found" }, 404);
  }

  const messages = await getMessageContext(sessionId, 50);
  return c.json(messages);
});

app.delete("/api/sessions/:sessionId", authMiddleware, async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  const session = await getSessionById(sessionId);
  if (!session || session.user_id !== user.id) {
    return c.json({ error: "Not found" }, 404);
  }

  await deleteSession(sessionId);
  return c.json({ success: true });
});

// Chat streaming endpoint
app.post("/api/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { sessionId, message } = body;

  // Validate session ownership
  const session = await getSessionById(sessionId);
  if (!session || session.user_id !== user.id) {
    return c.json({ error: "Invalid session" }, 403);
  }

  // Save user message
  await createMessage(sessionId, "user", message);

  // Get conversation context (last 10 messages)
  const context = await getMessageContext(sessionId, 10);

  // Add system prompt
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a helpful AI assistant. Be concise, accurate, and friendly. The user's name is ${user.name || "there"}.`,
    },
    ...context,
  ];

  // Update session title if this is the first message
  if (context.length <= 1) {
    generateTitle(message).then((title) => {
      updateSessionTitle(sessionId, title);
    });
  }

  // Stream the response
  return streamSSE(c, async (stream) => {
    let fullContent = "";

    try {
      for await (const chunk of streamChat(messages)) {
        fullContent += chunk;
        await stream.writeSSE({
          data: JSON.stringify({ content: chunk, done: false }),
        });
      }

      // Save assistant message
      await createMessage(sessionId, "assistant", fullContent);

      await stream.writeSSE({
        data: JSON.stringify({ content: "", done: true }),
      });
    } catch (error) {
      console.error("Stream error:", error);
      await stream.writeSSE({
        data: JSON.stringify({ error: String(error), done: true }),
      });
    }
  });
});

// ============================================
// Health Check
// ============================================

app.get("/health", async (c) => {
  const dbOk = await healthCheck();
  const ollamaOk = await checkOllamaHealth();

  return c.json({
    status: dbOk && ollamaOk ? "healthy" : "degraded",
    database: dbOk ? "connected" : "disconnected",
    ollama: ollamaOk ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// Server Startup
// ============================================

const port = parseInt(process.env.PORT || "3000");

console.log(`🚀 Starting chat.sudharsana.dev on port ${port}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await closeConnection();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  await closeConnection();
  process.exit(0);
});

export default {
  port,
  fetch: app.fetch,
};
