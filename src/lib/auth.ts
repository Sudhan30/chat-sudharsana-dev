/**
 * Authentication utilities
 * Uses Bun's native crypto for password hashing
 */

import {
  createUser,
  getUserByEmail,
  createAuthToken,
  getAuthToken,
  deleteAuthToken,
  type User,
} from "./db";

const TOKEN_EXPIRY_DAYS = 7;

/**
 * Hash password using Bun's native Argon2id
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sign up a new user
 */
export async function signup(
  email: string,
  password: string,
  name?: string
): Promise<{ user: User; token: string } | { error: string }> {
  // Check if user exists
  const existing = await getUserByEmail(email);
  if (existing) {
    return { error: "Email already registered" };
  }

  // Validate email
  if (!email.includes("@") || email.length < 5) {
    return { error: "Invalid email address" };
  }

  // Validate password
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash, name);

  // Create auth token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await createAuthToken(user.id, token, expiresAt);

  return { user, token };
}

/**
 * Login an existing user
 */
export async function login(
  email: string,
  password: string
): Promise<{ user: User; token: string } | { error: string }> {
  const user = await getUserByEmail(email);
  if (!user) {
    return { error: "Invalid email or password" };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return { error: "Invalid email or password" };
  }

  // Create new auth token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await createAuthToken(user.id, token, expiresAt);

  return { user, token };
}

/**
 * Logout - delete the auth token
 */
export async function logout(token: string): Promise<void> {
  await deleteAuthToken(token);
}

/**
 * Validate token and return user
 */
export async function validateToken(
  token: string
): Promise<User | null> {
  const result = await getAuthToken(token);
  if (!result) return null;
  return result.user;
}

/**
 * Check if user is approved
 */
export function isApproved(user: User): boolean {
  return user.approved === true;
}

/**
 * Extract token from cookie string
 */
export function extractTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === "auth_token") {
      return value;
    }
  }
  return null;
}

/**
 * Create Set-Cookie header value
 */
export function createAuthCookie(token: string): string {
  const maxAge = TOKEN_EXPIRY_DAYS * 24 * 60 * 60;
  return `auth_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

/**
 * Create cookie to clear auth
 */
export function createLogoutCookie(): string {
  return "auth_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
}
