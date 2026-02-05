/**
 * Layout Component for chat.sudharsana.dev
 * Server-side rendered with TailwindCSS
 */

import type { FC, ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
  title?: string;
}

export const Layout: FC<LayoutProps> = ({ children, title = "Chat" }) => {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} | chat.sudharsana.dev</title>
        <script src="https://cdn.tailwindcss.com" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
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
            `,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
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
              .scrollbar-thin::-webkit-scrollbar {
                width: 6px;
              }
              .scrollbar-thin::-webkit-scrollbar-track {
                background: transparent;
              }
              .scrollbar-thin::-webkit-scrollbar-thumb {
                background: #334155;
                border-radius: 3px;
              }
            `,
          }}
        />
      </head>
      <body className="bg-dark-950 text-dark-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
};

export default Layout;
