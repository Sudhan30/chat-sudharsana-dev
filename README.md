# chat.sudharsana.dev

High-performance AI chat application built with Bun, Hono, and Ollama.

## Features

- **Server-side rendered** dark mode UI
- **SSE streaming** for real-time AI responses
- **PostgreSQL** for persistent chat history
- **Session management** with conversation context
- **User authentication** with approval system ("Velvet Rope")
- **Low-latency** architecture optimized for Bun runtime

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Database:** PostgreSQL (via postgres.js)
- **AI:** Ollama (gemma model)
- **Styling:** TailwindCSS (CDN)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.x
- PostgreSQL 14+
- [Ollama](https://ollama.ai) with `gemma:latest` model

### 1. Install Dependencies

```bash
bun install
```

### 2. Setup Database

```bash
# Create database
createdb chat_db

# Run schema
psql -d chat_db -f schema.sql
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### 4. Start Ollama

```bash
ollama run gemma:latest
```

### 5. Run Server

```bash
# Development (hot reload)
bun dev

# Production
bun start
```

Visit http://localhost:3000

## Admin Commands

### Approve a User

```sql
-- By email
UPDATE users SET approved = true WHERE email = 'user@example.com';

-- By ID
UPDATE users SET approved = true WHERE id = 'uuid-here';
```

### View Pending Users

```sql
SELECT id, email, name, created_at FROM users WHERE approved = false;
```

### View All Sessions

```sql
SELECT s.id, s.title, u.email, s.created_at
FROM sessions s
JOIN users u ON s.user_id = u.id
ORDER BY s.created_at DESC;
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Redirect to chat |
| GET | `/login` | Login page |
| POST | `/login` | Login action |
| GET | `/signup` | Signup page |
| POST | `/signup` | Signup action |
| GET | `/logout` | Logout action |
| GET | `/chat` | Chat interface (auth required) |
| GET | `/chat/:id` | Chat session (auth required) |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id/messages` | Get session messages |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/chat` | Stream chat response (SSE) |
| GET | `/health` | Health check |

## Architecture

```
src/
├── lib/
│   ├── db.ts       # PostgreSQL connection & queries
│   ├── ai.ts       # Ollama streaming integration
│   └── auth.ts     # Authentication utilities
├── components/
│   ├── Layout.tsx  # HTML layout (JSX)
│   └── Chat.tsx    # Chat UI (JSX)
└── server.ts       # Hono application
```

## Performance Optimizations

1. **Connection Pooling:** postgres.js with max 20 connections
2. **Prepared Statements:** Enabled by default for faster queries
3. **SSE Streaming:** Token-by-token response for fast TTFB
4. **Context Window:** Last 10 messages for optimal memory usage
5. **Bun Native:** Uses Bun's native crypto and HTTP

## Deployment

### Docker

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE 3000
CMD ["bun", "start"]
```

### Kubernetes

See the cluster-infra repo for deployment manifests.

## License

MIT
