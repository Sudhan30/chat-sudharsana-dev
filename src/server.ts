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
  getUserById,
  updateSessionTitle,
  deleteSession,
  createMessage,
  getMessageContext,
  getEnhancedContext,
  getSessionMessageCount,
  saveSummary,
  healthCheck,
  closeConnection,
  approveUser,
  declineUser,
  type User,
} from "./lib/db";

import { notifyUserApprovalAction } from "./lib/notify";

import {
  streamChat,
  streamChatWithVision,
  chatWithTools,
  generateTitle,
  checkOllamaHealth,
  buildSystemPrompt,
  type ChatMessage,
  type MultimodalMessage,
  type LocationContext,
  type AgentStreamEvent,
} from "./lib/ai";

import {
  checkAgentDbHealth,
  closeAgentConnections,
} from "./lib/agent";

import { checkSearchHealth } from "./lib/search";
import { shouldTriggerSummarization, getSummaryType } from "./lib/summarization";

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

const renderLayout = (content: string, title = "Chat") => {
  const pageTitle = `${title} | chat.sudharsana.dev`;
  const description = "AI-powered chat application with web search, vision capabilities, and intelligent conversation summaries. Built by Sudharsana Rajasekaran.";
  const canonicalUrl = "https://chat.sudharsana.dev/";
  const ogImage = "https://chat.sudharsana.dev/og-image.jpg";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${pageTitle}</title>

  <!-- Primary Meta Tags -->
  <meta name="description" content="${description}" />
  <meta name="keywords" content="AI Chat, Ollama, LLM, Web Search, Vision AI, Multimodal AI, Chat Application, Sudharsana Rajasekaran" />
  <meta name="author" content="Sudharsana Rajasekaran" />
  <meta name="robots" content="index, follow" />
  <meta name="language" content="English" />
  <link rel="canonical" href="${canonicalUrl}" />

  <!-- AI Citation Meta Tags (Generative Engine Optimization) -->
  <meta name="citation_author" content="Sudharsana Rajasekaran" />
  <meta name="citation_title" content="${pageTitle}" />
  <meta name="DC.creator" content="Sudharsana Rajasekaran" />
  <meta name="DC.title" content="${pageTitle}" />
  <meta name="DC.publisher" content="chat.sudharsana.dev" />
  <meta name="DC.identifier" content="${canonicalUrl}" />
  <meta name="DC.type" content="Software" />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:site_name" content="chat.sudharsana.dev" />
  <meta property="og:locale" content="en_US" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${canonicalUrl}" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${ogImage}" />

  <!-- Geo Tags -->
  <meta name="geo.region" content="US-CA" />
  <meta name="geo.placename" content="San Francisco Bay Area" />
  <meta name="geo.position" content="37.7749;-122.4194" />
  <meta name="ICBM" content="37.7749, -122.4194" />

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "chat.sudharsana.dev",
    "description": "${description}",
    "url": "${canonicalUrl}",
    "applicationCategory": "CommunicationApplication",
    "operatingSystem": "Web Browser",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    "author": { "@type": "Person", "name": "Sudharsana Rajasekaran", "url": "https://sudharsana.dev" },
    "provider": { "@type": "Person", "name": "Sudharsana Rajasekaran" },
    "featureList": [
      "AI-powered chat conversations",
      "Web search integration",
      "Vision and image analysis",
      "Conversation summaries",
      "Location-aware responses"
    ]
  }
  </script>

  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/static/design-system.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    (function () {
      try {
        var t = localStorage.getItem('chat-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
</head>
<body>
  ${content}
</body>
</html>
`;
};

const authLogoSvg = `
  <div class="ds-logo" style="width:44px;height:44px;border-radius:12px;">
    <span class="ds-logo-char" style="font-size:26px;">s.</span>
    <span class="ds-logo-dot" style="right:8px;bottom:9px;width:5px;height:5px;"></span>
  </div>
`;

const themeToggleBtn = `
  <button onclick="toggleTheme()" aria-label="Toggle theme" title="Toggle theme"
    style="position:fixed;top:16px;right:16px;z-index:1000;width:36px;height:36px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);color:var(--fg-2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:15px;line-height:1;">
    <span id="theme-icon">☾</span>
  </button>
  <script>
    function toggleTheme() {
      var el = document.documentElement;
      var t = el.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      el.setAttribute('data-theme', t);
      try { localStorage.setItem('chat-theme', t); } catch (e) {}
      var icon = document.getElementById('theme-icon');
      if (icon) icon.textContent = t === 'dark' ? '☾' : '☀';
    }
    (function () {
      var icon = document.getElementById('theme-icon');
      if (icon) icon.textContent = (document.documentElement.getAttribute('data-theme') === 'light') ? '☀' : '☾';
    })();
  </script>
`;

const renderLogin = (error?: string) => renderLayout(`
  ${themeToggleBtn}
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;">
    <div class="ds-auth-glow"></div>
    <div style="width:100%;max-width:400px;position:relative;z-index:1;background:var(--surface);border:1px solid var(--border-2);border-radius:20px;padding:32px;box-shadow:var(--shadow-lg);">
      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:24px;">
        ${authLogoSvg}
        <div style="font-family:var(--font-display);font-size:34px;line-height:1.1;margin-top:16px;color:var(--fg-1);letter-spacing:-0.02em;">
          Welcome <em style="color:var(--amber-300);">back</em>
        </div>
        <div style="color:var(--fg-3);font-size:14px;margin-top:6px;">Sign in to continue</div>
      </div>

      ${error ? `<div style="background:color-mix(in srgb, var(--red-500) 10%, transparent);border:1px solid color-mix(in srgb, var(--red-500) 25%, transparent);color:var(--red-500);padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px;">${error}</div>` : ""}

      <form method="POST" action="/login" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:500;color:var(--fg-2);margin-bottom:6px;">Email</label>
          <input type="email" name="email" required class="ds-input" placeholder="you@example.com" />
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:500;color:var(--fg-2);margin-bottom:6px;">Password</label>
          <input type="password" name="password" required class="ds-input" placeholder="••••••••" />
        </div>
        <button type="submit" class="ds-btn-primary" style="width:100%;padding:12px 16px;font-size:15px;margin-top:4px;">Sign in</button>
      </form>

      <div style="text-align:center;margin-top:20px;font-size:13px;color:var(--fg-3);">
        Don't have an account? <a href="/signup" style="color:var(--blue-400);">Sign up</a>
      </div>
    </div>
  </div>
`, "Sign in");

const renderSignup = (error?: string) => renderLayout(`
  ${themeToggleBtn}
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;">
    <div class="ds-auth-glow"></div>
    <div style="width:100%;max-width:400px;position:relative;z-index:1;background:var(--surface);border:1px solid var(--border-2);border-radius:20px;padding:32px;box-shadow:var(--shadow-lg);">
      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:24px;">
        ${authLogoSvg}
        <div style="font-family:var(--font-display);font-size:34px;line-height:1.1;margin-top:16px;color:var(--fg-1);letter-spacing:-0.02em;">
          Join the <em style="color:var(--amber-300);">chat</em>
        </div>
        <div style="color:var(--fg-3);font-size:14px;margin-top:6px;">Request access to the model</div>
      </div>

      ${error ? `<div style="background:color-mix(in srgb, var(--red-500) 10%, transparent);border:1px solid color-mix(in srgb, var(--red-500) 25%, transparent);color:var(--red-500);padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px;">${error}</div>` : ""}

      <form method="POST" action="/signup" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:500;color:var(--fg-2);margin-bottom:6px;">Name</label>
          <input type="text" name="name" class="ds-input" placeholder="Your name" />
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:500;color:var(--fg-2);margin-bottom:6px;">Email</label>
          <input type="email" name="email" required class="ds-input" placeholder="you@example.com" />
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:500;color:var(--fg-2);margin-bottom:6px;">Password</label>
          <input type="password" name="password" required minlength="8" class="ds-input" placeholder="••••••••" />
        </div>
        <button type="submit" class="ds-btn-primary" style="width:100%;padding:12px 16px;font-size:15px;margin-top:4px;">Create account</button>
      </form>

      <div style="text-align:center;margin-top:20px;font-size:13px;color:var(--fg-3);">
        Already have an account? <a href="/login" style="color:var(--blue-400);">Sign in</a>
      </div>
    </div>
  </div>
`, "Sign up");

const renderPendingApproval = (email: string) => renderLayout(`
  ${themeToggleBtn}
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;">
    <div class="ds-auth-glow"></div>
    <div style="width:100%;max-width:400px;position:relative;z-index:1;background:var(--surface);border:1px solid var(--border-2);border-radius:20px;padding:32px;box-shadow:var(--shadow-lg);text-align:center;">
      <div style="width:56px;height:56px;border-radius:999px;margin:0 auto 20px;background:color-mix(in srgb, var(--yellow-500) 12%, transparent);border:1px solid color-mix(in srgb, var(--yellow-500) 30%, transparent);display:flex;align-items:center;justify-content:center;color:var(--yellow-500);">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 3"></path>
        </svg>
      </div>
      <div style="font-size:22px;font-weight:600;color:var(--fg-1);margin-bottom:8px;">Pending approval</div>
      <div style="color:var(--fg-2);font-size:14px;line-height:1.55;margin-bottom:4px;">
        Your account <code style="font-size:0.9em;">${email}</code> is awaiting approval.
      </div>
      <div style="color:var(--fg-3);font-size:13px;">
        You'll be notified once it's approved.
      </div>
      <a href="/logout" style="display:inline-block;margin-top:20px;color:var(--blue-400);font-size:13px;">Sign out</a>
    </div>
  </div>
`, "Pending approval");

function escapeInitials(source: string): string {
  const cleaned = source.replace(/@.*$/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const raw = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : cleaned.slice(0, 2);
  return raw.toUpperCase().slice(0, 2);
}

function renderEmptyState(): string {
  return `
    <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:24px;position:relative;">
      <div style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(1200px 600px at 50% -20%, var(--blue-glow), transparent);"></div>
      <div style="position:relative;z-index:1;text-align:center;max-width:520px;">
        <div class="caption" style="margin-bottom:12px;">gemma · local</div>
        <div style="font-family:var(--font-display);font-size:56px;line-height:1.05;color:var(--fg-1);margin-bottom:12px;letter-spacing:-0.02em;">
          What can I help <span style="font-style:italic;color:var(--blue-400);">with?</span>
        </div>
        <div style="color:var(--fg-3);font-size:15px;margin-bottom:28px;">
          I'm running on your machine. Ask anything &mdash; code, questions, an image to look at.
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
          <button class="ds-chip" onclick="createNewSession()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>
            Start a new conversation
          </button>
        </div>
      </div>
    </div>
  `;
}

const renderChat = (user: User, sessions: any[], currentSessionId?: string) => renderLayout(`
  <div id="chat-root" style="display:flex;height:100vh;height:100dvh;width:100%;background:var(--canvas);position:relative;overflow:hidden;">
    <!-- Mobile backdrop -->
    <div id="sidebar-scrim" class="ds-backdrop" style="position:absolute;inset:0;z-index:40;display:none;"></div>

    <!-- Sidebar -->
    <aside id="sidebar" style="width:280px;background:var(--canvas-2);border-right:1px solid var(--border-1);display:flex;flex-direction:column;height:100%;flex-shrink:0;position:relative;z-index:50;transition:transform 220ms var(--ease-out);">
      <div style="padding:16px;display:flex;align-items:center;gap:10px;">
        <div class="ds-logo" style="width:32px;height:32px;border-radius:9px;">
          <span class="ds-logo-char" style="font-size:19px;">s.</span>
          <span class="ds-logo-dot" style="right:6px;bottom:6px;width:3.5px;height:3.5px;"></span>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--fg-1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          chat<span style="color:var(--fg-3);">.sudharsana.dev</span>
        </div>
        <button id="sidebar-close" class="ds-btn-ghost" style="display:none;" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div style="padding:0 12px 12px;">
        <button onclick="createNewSession()" class="ds-btn-primary" style="width:100%;padding:10px 14px;font-size:14px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          New chat
        </button>
      </div>

      <div class="caption" style="padding:4px 20px 8px;font-size:10px;">Conversations</div>

      <div class="scrollbar-thin" style="flex:1;overflow-y:auto;padding:0 8px;">
        ${sessions.map((s) => `
          <a href="/chat/${s.id}" class="ds-session${s.id === currentSessionId ? " is-active" : ""}">
            <span class="ds-session-title">${s.title || "New conversation"}</span>
          </a>
        `).join("")}
        ${sessions.length === 0 ? `<div style="padding:16px 12px;color:var(--fg-4);font-size:12px;text-align:center;">No conversations yet</div>` : ""}
      </div>

      <div style="padding:12px;border-top:1px solid var(--border-1);display:flex;align-items:center;gap:10px;">
        <div style="width:30px;height:30px;border-radius:999px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:var(--blue-600);color:#fff;font-size:12px;font-weight:600;">
          ${escapeInitials(user.name || user.email)}
        </div>
        <div style="flex:1;min-width:0;overflow:hidden;">
          <div style="font-size:13px;font-weight:500;color:var(--fg-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${user.name || user.email.split("@")[0]}
          </div>
          <div style="font-size:11px;color:var(--fg-3);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${user.email}
          </div>
        </div>
        <button onclick="toggleTheme()" class="ds-btn-ghost" title="Toggle theme" aria-label="Toggle theme" style="width:28px;height:28px;">
          <span id="theme-icon" style="font-size:14px;line-height:1;">☾</span>
        </button>
        <a href="/logout" class="ds-btn-ghost" title="Sign out" aria-label="Sign out" style="width:28px;height:28px;color:var(--fg-3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </a>
      </div>
    </aside>

    <!-- Main Chat Area -->
    <main style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative;">
      <!-- Sticky top bar -->
      <header class="ds-sticky-bar" style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid var(--border-1);position:sticky;top:0;z-index:10;">
        <button id="sidebar-open" class="ds-btn-ghost" style="display:none;" aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>
        </button>
        <div style="flex:1;min-width:0;">
          <div id="session-title" style="font-size:14px;font-weight:500;color:var(--fg-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${currentSessionId ? (sessions.find((s) => s.id === currentSessionId)?.title || "New conversation") : "Chat"}
          </div>
          <div style="font-size:11px;color:var(--fg-4);font-family:var(--font-mono);">
            <span style="color:var(--green-500);">●</span> gemma · local
          </div>
        </div>
      </header>

      <!-- Messages -->
      <div id="messages" class="scrollbar-thin" style="flex:1;overflow-y:auto;padding:${currentSessionId ? "24px 20px 8px" : "0"};">
        ${!currentSessionId ? renderEmptyState() : `
          <div id="message-container" style="max-width:820px;margin:0 auto;"></div>
          <div id="typing-indicator" style="display:none;max-width:820px;margin:0 auto 20px;">
            <div style="display:flex;align-items:flex-start;gap:12px;">
              <div style="width:32px;height:32px;border-radius:999px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:13px;font-weight:600;font-family:var(--font-mono);">g</div>
              <div style="padding:14px 16px;background:var(--surface-2);border:1px solid var(--border-1);border-radius:20px;border-top-left-radius:6px;display:flex;gap:4px;" class="typing-indicator">
                <span style="width:6px;height:6px;border-radius:50%;background:var(--fg-3);"></span>
                <span style="width:6px;height:6px;border-radius:50%;background:var(--fg-3);"></span>
                <span style="width:6px;height:6px;border-radius:50%;background:var(--fg-3);"></span>
              </div>
            </div>
          </div>
        `}
      </div>

      <!-- Composer -->
      ${currentSessionId ? `
        <div style="max-width:820px;width:100%;margin:0 auto;padding:12px 20px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--border-1);background:var(--canvas);">
          <div id="image-preview" style="display:none;align-items:center;gap:10px;padding:8px;margin-bottom:10px;background:var(--surface);border-radius:12px;border:1px solid var(--border-2);width:fit-content;">
            <img id="preview-img" style="max-height:44px;width:auto;border-radius:8px;" />
            <div style="font-size:13px;color:var(--fg-2);">
              <div style="color:var(--fg-1);font-weight:500;">Image attached</div>
              <div style="font-size:11px;color:var(--fg-4);font-family:var(--font-mono);">ready to send</div>
            </div>
            <button type="button" onclick="clearImage()" style="width:24px;height:24px;border-radius:999px;background:var(--surface-3);border:none;color:var(--fg-2);cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Remove image">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>

          <form id="chat-form" class="ds-composer-shell">
            <input type="hidden" id="session-id" value="${currentSessionId}" />
            <input type="file" id="image-input" accept="image/*" style="display:none;" onchange="handleImageSelect(event)" />
            <button type="button" onclick="document.getElementById('image-input').click()" title="Attach image" aria-label="Attach image" style="width:36px;height:36px;border-radius:10px;border:none;background:transparent;color:var(--fg-3);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all var(--dur-fast) var(--ease-out);flex-shrink:0;"
              onmouseover="this.style.background='var(--surface-2)';this.style.color='var(--fg-1)';"
              onmouseout="this.style.background='transparent';this.style.color='var(--fg-3)';">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>

            <textarea id="message-input" class="ds-composer-textarea" placeholder="Message the model" rows="1" onkeydown="handleKeyDown(event)"></textarea>

            <button type="submit" class="ds-send" id="send-btn" aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
            </button>
          </form>

          <div style="margin-top:8px;display:flex;justify-content:space-between;font-size:11px;color:var(--fg-4);font-family:var(--font-mono);">
            <span>↵ send · shift+↵ newline</span>
            <span>gemma · local</span>
          </div>
        </div>
      ` : `
        <div style="padding:12px 20px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--border-1);background:var(--canvas);">
          <button onclick="createNewSession()" class="ds-btn-primary" style="width:100%;max-width:820px;margin:0 auto;display:flex;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            Start a new conversation
          </button>
        </div>
      `}
    </main>
  </div>

  <script>
    const sessionId = document.getElementById('session-id')?.value;
    const messageContainer = document.getElementById('message-container');
    const typingIndicator = document.getElementById('typing-indicator');
    const messagesDiv = document.getElementById('messages');
    const userName = ${JSON.stringify(user.name || "there")};
    const userInitials = ${JSON.stringify(escapeInitials(user.name || user.email))};

    let userLocation = null;
    let pendingImageBase64 = null;

    // ---------- Theme toggle ----------
    function toggleTheme() {
      const el = document.documentElement;
      const next = el.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      el.setAttribute('data-theme', next);
      try { localStorage.setItem('chat-theme', next); } catch (e) {}
      const icon = document.getElementById('theme-icon');
      if (icon) icon.textContent = next === 'dark' ? '\u263E' : '\u2600';
    }
    (function syncThemeIcon() {
      const icon = document.getElementById('theme-icon');
      if (icon) icon.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '\u2600' : '\u263E';
    })();

    // ---------- Mobile sidebar drawer ----------
    const sidebarEl = document.getElementById('sidebar');
    const scrimEl = document.getElementById('sidebar-scrim');
    const openBtn = document.getElementById('sidebar-open');
    const closeBtn = document.getElementById('sidebar-close');

    function applyBreakpoint() {
      const isMobile = window.innerWidth < 780;
      if (isMobile) {
        sidebarEl.style.position = 'absolute';
        sidebarEl.style.left = '0';
        sidebarEl.style.top = '0';
        sidebarEl.style.bottom = '0';
        sidebarEl.style.transform = sidebarEl.dataset.open === 'true' ? 'translateX(0)' : 'translateX(-100%)';
        openBtn.style.display = 'inline-flex';
        closeBtn.style.display = 'inline-flex';
      } else {
        sidebarEl.style.position = 'relative';
        sidebarEl.style.transform = 'none';
        scrimEl.style.display = 'none';
        sidebarEl.dataset.open = 'false';
        openBtn.style.display = 'none';
        closeBtn.style.display = 'none';
      }
    }
    function openSidebar() {
      sidebarEl.dataset.open = 'true';
      sidebarEl.style.transform = 'translateX(0)';
      scrimEl.style.display = 'block';
    }
    function closeSidebar() {
      sidebarEl.dataset.open = 'false';
      sidebarEl.style.transform = 'translateX(-100%)';
      scrimEl.style.display = 'none';
    }
    openBtn?.addEventListener('click', openSidebar);
    closeBtn?.addEventListener('click', closeSidebar);
    scrimEl?.addEventListener('click', closeSidebar);
    window.addEventListener('resize', applyBreakpoint);
    applyBreakpoint();

    // ---------- Geolocation (best-effort) ----------
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          userLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          try {
            const res = await fetch(\`https://nominatim.openstreetmap.org/reverse?lat=\${pos.coords.latitude}&lon=\${pos.coords.longitude}&format=json\`);
            const data = await res.json();
            if (data.address) {
              userLocation.city = data.address.city || data.address.town || data.address.village;
              userLocation.country = data.address.country;
            }
          } catch (e) { /* silent */ }
        },
        () => { /* silent */ },
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }

    // ---------- Image attach ----------
    function handleImageSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        pendingImageBase64 = e.target.result.split(',')[1];
        document.getElementById('preview-img').src = e.target.result;
        document.getElementById('image-preview').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    }
    function clearImage() {
      pendingImageBase64 = null;
      document.getElementById('image-input').value = '';
      document.getElementById('image-preview').style.display = 'none';
    }

    // ---------- Safe DOM helpers ----------
    function scrollToBottom() { messagesDiv.scrollTop = messagesDiv.scrollHeight; }
    function handleKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true }));
      }
    }

    function makeAvatar(isUser) {
      const el = document.createElement('div');
      el.style.cssText = 'width:32px;height:32px;border-radius:999px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:600;';
      if (isUser) {
        el.style.background = 'var(--blue-600)';
        el.style.fontSize = '12px';
        el.textContent = userInitials;
      } else {
        el.style.background = 'linear-gradient(135deg,#10b981,#059669)';
        el.style.fontFamily = 'var(--font-mono)';
        el.textContent = 'g';
      }
      return el;
    }

    function makeBubbleShell(role) {
      const isUser = role === 'user';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;margin-bottom:20px;' + (isUser ? 'flex-direction:row-reverse;' : '');
      row.appendChild(makeAvatar(isUser));

      const col = document.createElement('div');
      col.style.cssText = 'max-width:72%;min-width:0;';

      const meta = document.createElement('div');
      meta.className = 'meta-row';
      meta.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';
      col.appendChild(meta);

      const bubble = document.createElement('div');
      bubble.className = isUser ? 'ds-bubble-user' : 'ds-bubble-ai';
      bubble.style.cssText = 'padding:11px 16px;border-radius:20px;font-size:15px;line-height:1.55;word-break:break-word;';
      if (isUser) {
        bubble.style.background = 'var(--blue-600)';
        bubble.style.color = '#fff';
        bubble.style.borderTopRightRadius = '6px';
      } else {
        bubble.style.background = 'var(--surface-2)';
        bubble.style.color = 'var(--fg-1)';
        bubble.style.border = '1px solid var(--border-1)';
        bubble.style.borderTopLeftRadius = '6px';
      }
      const content = document.createElement('div');
      content.className = 'message-content streaming-text';
      content.style.whiteSpace = 'pre-wrap';
      bubble.appendChild(content);
      col.appendChild(bubble);
      row.appendChild(col);

      return { row, meta, content };
    }

    function appendMessage(role, text) {
      const { row, content } = makeBubbleShell(role);
      if (role === 'assistant' && window.marked && marked.parse) {
        const cleaned = String(text).replace(/\\n{3,}/g, '\\n\\n').trim();
        content.classList.remove('streaming-text');
        const parsed = marked.parse(cleaned);
        // marked output is trusted assistant content; render as HTML.
        content.innerHTML = parsed;
      } else {
        content.textContent = text;
      }
      messageContainer.appendChild(row);
    }

    function upsertPill(metaEl, kind, text) {
      const klass = { search: 'ds-pill-search', agent: 'ds-pill-agent', tool: 'ds-pill-tool', ok: 'ds-pill-ok' }[kind] || '';
      let el = metaEl.querySelector('[data-kind="' + kind + '"]');
      if (!el) {
        el = document.createElement('span');
        el.className = 'ds-pill ' + klass;
        el.setAttribute('data-kind', kind);
        const dot = document.createElement('span');
        dot.className = 'ds-dot';
        el.appendChild(dot);
        const label = document.createElement('span');
        label.className = 'ds-pill-label';
        el.appendChild(label);
        metaEl.appendChild(el);
      }
      el.querySelector('.ds-pill-label').textContent = text;
    }

    // ---------- Load existing messages ----------
    if (sessionId) loadMessages();

    async function loadMessages() {
      const res = await fetch('/api/sessions/' + sessionId + '/messages');
      const messages = await res.json();
      messageContainer.replaceChildren();
      if (messages.length === 0) {
        appendMessage('assistant', 'Hello ' + userName + '. What can I help with?');
      } else {
        messages.forEach(msg => appendMessage(msg.role, msg.content));
      }
      scrollToBottom();
    }

    // ---------- Submit ----------
    document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('message-input');
      const sendBtn = document.getElementById('send-btn');
      const message = input.value.trim();
      if (!message && !pendingImageBase64) return;

      const displayMsg = message || (pendingImageBase64 ? '[Image]' : '');
      appendMessage('user', displayMsg);
      input.value = '';
      input.style.height = 'auto';
      scrollToBottom();

      typingIndicator.style.display = 'block';
      sendBtn.disabled = true;
      scrollToBottom();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: message || 'What is in this image?',
            location: userLocation,
            imageBase64: pendingImageBase64,
          }),
        });

        clearImage();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Keep the typing indicator visible until we get the first event
        // from the server. Cold-start loads can take ~10s — hiding the
        // dots the instant the HTTP stream opens makes it look frozen.
        let row = null, meta = null, content = null;
        function ensureBubble() {
          if (row) return;
          typingIndicator.style.display = 'none';
          const shell = makeBubbleShell('assistant');
          row = shell.row; meta = shell.meta; content = shell.content;
          messageContainer.appendChild(row);
        }

        let fullContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          const lines = text.split('\\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'meta' && data.search) {
                ensureBubble();
                upsertPill(meta, 'search', 'searched web for context');
              }
              if (data.type === 'status') {
                ensureBubble();
                upsertPill(meta, 'agent', data.content);
              }
              if (data.content) {
                ensureBubble();
                fullContent += data.content;
                content.textContent = fullContent;
                scrollToBottom();
              }
            } catch {}
          }
        }

        // Stream ended with no events at all — still need to hide the dots.
        if (!row) typingIndicator.style.display = 'none';

        if (content && fullContent && window.marked && marked.parse) {
          const cleaned = fullContent.replace(/\\n{3,}/g, '\\n\\n').trim();
          content.classList.remove('streaming-text');
          // marked output is trusted assistant content; render as HTML.
          content.innerHTML = marked.parse(cleaned);
        }
      } catch (err) {
        typingIndicator.style.display = 'none';
        console.error('Chat error:', err);
      } finally {
        sendBtn.disabled = false;
      }
    });

    // Auto-grow textarea
    const ta = document.getElementById('message-input');
    if (ta) {
      ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
      });
    }

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

// SEO files
app.get("/robots.txt", async (c) => {
  const file = Bun.file("./public/robots.txt");
  const content = await file.text();
  return c.text(content);
});

app.get("/sitemap.xml", async (c) => {
  const file = Bun.file("./public/sitemap.xml");
  const content = await file.text();
  c.header("Content-Type", "application/xml");
  return c.body(content);
});

// Serve blog page
app.get("/blog", async (c) => {
  const file = Bun.file("./public/blog.html");
  const content = await file.text();
  return c.html(content);
});

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

/**
 * Check if summarization is needed and run it in background
 */
async function triggerSummarizationIfNeeded(sessionId: string): Promise<void> {
  try {
    const messageCount = await getSessionMessageCount(sessionId);

    // Check if we should summarize (every 10 messages)
    if (shouldTriggerSummarization(messageCount)) {
      const summaryType = getSummaryType(messageCount);

      if (summaryType) {
        console.log(`📝 Triggering ${summaryType} summarization for session ${sessionId} (msg count: ${messageCount})`);

        // Get messages to summarize
        // For detailed summary: last 50 messages
        // For high-level summary: all messages
        const limit = summaryType === "detailed" ? 50 : 1000;
        const messages = await getSessionMessages(sessionId, limit);

        // Convert to format expected by summarizer
        const messagesForSummary = messages.map(m => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at
        }));

        // Generate summary
        const summaryText = await generateSummary(messagesForSummary, summaryType);
        const tokenCount = estimateTokenCount(summaryText);

        // Save to database
        // Define range based on current count
        const rangeEnd = messageCount;
        const rangeStart = Math.max(1, rangeEnd - (summaryType === "detailed" ? 49 : rangeEnd - 1));

        await saveSummary(
          sessionId,
          summaryType,
          rangeStart,
          rangeEnd,
          summaryText,
          tokenCount
        );

        console.log(`✅ Saved ${summaryType} summary (${tokenCount} tokens) for session ${sessionId}`);
      }
    }
  } catch (error) {
    console.error("Error in background summarization:", error);
    // Don't throw, just log - background task shouldn't crash request
  }
}

// Chat streaming endpoint with search, location, and vision support
app.post("/api/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { sessionId, message, location, imageBase64 } = body;

  // Validate session ownership
  const session = await getSessionById(sessionId);
  if (!session || session.user_id !== user.id) {
    return c.json({ error: "Invalid session" }, 403);
  }

  // Save user message
  await createMessage(sessionId, "user", message);

  // Trigger summarization in background if needed (don't block response)
  triggerSummarizationIfNeeded(sessionId).catch(err =>
    console.error('Background summarization failed:', err)
  );

  // Get enhanced conversation context (summaries + recent messages)
  const context = await getEnhancedContext(sessionId, 5);

  // Parse location if provided
  let locationContext: LocationContext | undefined;
  if (location && typeof location === "object") {
    locationContext = {
      latitude: location.latitude,
      longitude: location.longitude,
      city: location.city,
      country: location.country,
    };
  }

  // Build system prompt with location, search (as tool), and data agent capabilities
  const systemPrompt = buildSystemPrompt(
    user.name || "there",
    locationContext,
    true, // search enabled (as tool)
    true  // data agent enabled
  );

  // Check if this is a multimodal request (has image)
  const hasImage = imageBase64 && imageBase64.length > 0;

  // Update session title if this is the first message
  if (context.length <= 1) {
    generateTitle(message).then((title) => {
      updateSessionTitle(sessionId, title);
    });
  }

  // Stream the response
  return streamSSE(c, async (stream) => {
    let fullContent = "";
    console.log(`[Chat] Starting stream for session ${sessionId}, hasImage=${hasImage}`);

    try {
      if (hasImage) {
        // Use vision-capable streaming for image analysis
        const multimodalMessages: MultimodalMessage[] = [
          { role: "system", content: systemPrompt },
          ...context.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          {
            role: "user",
            content: message,
            images: [imageBase64], // Base64 image
          },
        ];

        for await (const chunk of streamChatWithVision(multimodalMessages)) {
          fullContent += chunk;
          await stream.writeSSE({
            data: JSON.stringify({ content: chunk, done: false }),
          });
        }
      } else {
        // Text chat with tool calling (data agent + web search)
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...context,
        ];

        // Remove duplicate last user message and add current message
        if (messages.length > 1 && messages[messages.length - 1].role === "user") {
          messages.pop();
        }
        messages.push({ role: "user", content: message });

        const searchLocation = locationContext
          ? { city: locationContext.city, country: locationContext.country }
          : undefined;

        for await (const event of chatWithTools(messages, {}, searchLocation)) {
          if (event.type === "status") {
            // Send status indicator to client (e.g., "Querying database...")
            await stream.writeSSE({
              data: JSON.stringify({
                type: "status",
                content: event.content,
                done: false,
              }),
            });
          } else if (event.type === "text") {
            fullContent += event.content;
            await stream.writeSSE({
              data: JSON.stringify({ content: event.content, done: false }),
            });
          }
          // tool_result events are internal - not sent to client
        }
      }

      // Save assistant message
      await createMessage(sessionId, "assistant", fullContent);

      await stream.writeSSE({
        data: JSON.stringify({ content: "", done: true }),
      });
    } catch (error) {
      console.error("Stream error:", error);
      console.error("Stream error stack:", error instanceof Error ? error.stack : "no stack");
      await stream.writeSSE({
        data: JSON.stringify({ error: String(error), done: true }),
      });
    }
  });
});

// ============================================
// Admin User Approval API
// ============================================

app.get("/api/admin/approve", async (c) => {
  const userId = c.req.query("userId");
  const action = c.req.query("action");

  if (!userId || !action) {
    return c.html(renderAdminResult("error", "Missing userId or action parameter"), 400);
  }

  if (action !== "approve" && action !== "decline") {
    return c.html(renderAdminResult("error", "Invalid action. Must be 'approve' or 'decline'"), 400);
  }

  try {
    if (action === "approve") {
      const user = await approveUser(userId);
      if (!user) {
        return c.html(renderAdminResult("error", "User not found"), 404);
      }
      // Notify about the approval
      notifyUserApprovalAction(user.email, "approved").catch(console.error);
      return c.html(renderAdminResult("success", `User ${user.email} has been approved!`));
    } else {
      const user = await getUserById(userId);
      if (!user) {
        return c.html(renderAdminResult("error", "User not found"), 404);
      }
      const email = user.email;
      const deleted = await declineUser(userId);
      if (!deleted) {
        return c.html(renderAdminResult("error", "User was already approved or not found"), 400);
      }
      // Notify about the decline
      notifyUserApprovalAction(email, "declined").catch(console.error);
      return c.html(renderAdminResult("success", `User ${email} has been declined and removed.`));
    }
  } catch (error) {
    console.error("Admin approval error:", error);
    return c.html(renderAdminResult("error", "An error occurred processing the request"), 500);
  }
});

function renderAdminResult(status: "success" | "error", message: string): string {
  const isOk = status === "success";
  const tokenColor = isOk ? "var(--green-500)" : "var(--red-500)";
  const title = isOk ? "Success" : "Error";

  const iconSvg = isOk
    ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
    : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

  return renderLayout(`
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;">
      <div class="ds-auth-glow"></div>
      <div style="width:100%;max-width:420px;position:relative;z-index:1;background:var(--surface);border:1px solid var(--border-2);border-radius:20px;padding:40px;box-shadow:var(--shadow-lg);text-align:center;">
        <div style="width:64px;height:64px;border-radius:999px;margin:0 auto 20px;background:color-mix(in srgb, ${tokenColor} 12%, transparent);border:1px solid color-mix(in srgb, ${tokenColor} 30%, transparent);display:flex;align-items:center;justify-content:center;color:${tokenColor};">
          ${iconSvg}
        </div>
        <div style="font-family:var(--font-display);font-size:30px;line-height:1.1;color:var(--fg-1);letter-spacing:-0.02em;margin-bottom:8px;">${title}</div>
        <div style="color:var(--fg-2);font-size:14px;line-height:1.55;">${message}</div>
      </div>
    </div>
  `, title);
}

// ============================================
// Health Check
// ============================================

app.get("/health", async (c) => {
  const dbOk = await healthCheck();
  const ollamaOk = await checkOllamaHealth();
  const agentDbs = await checkAgentDbHealth();

  return c.json({
    status: dbOk && ollamaOk ? "healthy" : "degraded",
    database: dbOk ? "connected" : "disconnected",
    ollama: ollamaOk ? "connected" : "disconnected",
    agent: {
      blogDb: agentDbs.blogDb ? "connected" : "disconnected",
      tradingDb: agentDbs.tradingDb ? "connected" : "disconnected",
    },
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
  await closeAgentConnections();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  await closeConnection();
  await closeAgentConnections();
  process.exit(0);
});

export default {
  port,
  fetch: app.fetch,
};
