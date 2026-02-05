/**
 * PostgreSQL Database Connection using postgres.js
 * Optimized for Bun runtime with connection pooling
 */

import postgres from "postgres";

// Database configuration from environment
const DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/chat_db";

// Create postgres connection with optimized settings
export const sql = postgres(DATABASE_URL, {
  max: 20,                    // Max connections in pool
  idle_timeout: 20,           // Close idle connections after 20s
  connect_timeout: 10,        // Connection timeout
  prepare: true,              // Use prepared statements for performance
  transform: {
    undefined: null,          // Transform undefined to null
  },
});

// Types
export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  approved: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
}

export interface AuthToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

// ============================================
// User Operations
// ============================================

export async function createUser(
  email: string,
  passwordHash: string,
  name?: string
): Promise<User> {
  const [user] = await sql<User[]>`
    INSERT INTO users (email, password_hash, name)
    VALUES (${email}, ${passwordHash}, ${name || null})
    RETURNING *
  `;
  return user;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await sql<User[]>`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;
  return user || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [user] = await sql<User[]>`
    SELECT * FROM users WHERE id = ${id} LIMIT 1
  `;
  return user || null;
}

export async function isUserApproved(userId: string): Promise<boolean> {
  const [result] = await sql<{ approved: boolean }[]>`
    SELECT approved FROM users WHERE id = ${userId} LIMIT 1
  `;
  return result?.approved ?? false;
}

// ============================================
// Auth Token Operations
// ============================================

export async function createAuthToken(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<AuthToken> {
  const [authToken] = await sql<AuthToken[]>`
    INSERT INTO auth_tokens (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
    RETURNING *
  `;
  return authToken;
}

export async function getAuthToken(token: string): Promise<(AuthToken & { user: User }) | null> {
  const [result] = await sql<(AuthToken & { user: User })[]>`
    SELECT
      at.*,
      u.id as user_id,
      u.email as user_email,
      u.name as user_name,
      u.approved as user_approved
    FROM auth_tokens at
    JOIN users u ON at.user_id = u.id
    WHERE at.token = ${token} AND at.expires_at > NOW()
    LIMIT 1
  `;

  if (!result) return null;

  return {
    ...result,
    user: {
      id: result.user_id,
      email: (result as any).user_email,
      password_hash: "",
      name: (result as any).user_name,
      approved: (result as any).user_approved,
      created_at: result.created_at,
      updated_at: result.created_at,
    },
  };
}

export async function deleteAuthToken(token: string): Promise<void> {
  await sql`DELETE FROM auth_tokens WHERE token = ${token}`;
}

export async function cleanExpiredTokens(): Promise<void> {
  await sql`DELETE FROM auth_tokens WHERE expires_at < NOW()`;
}

// ============================================
// Session Operations
// ============================================

export async function createSession(userId: string, title?: string): Promise<Session> {
  const [session] = await sql<Session[]>`
    INSERT INTO sessions (user_id, title)
    VALUES (${userId}, ${title || "New Chat"})
    RETURNING *
  `;
  return session;
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  const [session] = await sql<Session[]>`
    SELECT * FROM sessions WHERE id = ${sessionId} LIMIT 1
  `;
  return session || null;
}

export async function getUserSessions(userId: string, limit = 50): Promise<Session[]> {
  return sql<Session[]>`
    SELECT * FROM sessions
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await sql`
    UPDATE sessions SET title = ${title} WHERE id = ${sessionId}
  `;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
}

// ============================================
// Message Operations
// ============================================

export async function createMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<Message> {
  const [message] = await sql<Message[]>`
    INSERT INTO messages (session_id, role, content)
    VALUES (${sessionId}, ${role}, ${content})
    RETURNING *
  `;

  // Update session's updated_at
  await sql`UPDATE sessions SET updated_at = NOW() WHERE id = ${sessionId}`;

  return message;
}

export async function getSessionMessages(
  sessionId: string,
  limit = 10
): Promise<Message[]> {
  // Get last N messages for context, ordered oldest first for conversation flow
  return sql<Message[]>`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) sub
    ORDER BY created_at ASC
  `;
}

export async function getMessageContext(
  sessionId: string,
  limit = 10
): Promise<Array<{ role: string; content: string }>> {
  const messages = await getSessionMessages(sessionId, limit);
  return messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
}

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Graceful shutdown
export async function closeConnection(): Promise<void> {
  await sql.end();
}
