/**
 * Session cookie helpers — the only place that knows how the session token
 * is transported.
 *
 * The cookie is HttpOnly (inaccessible to client JS), SameSite=Lax (CSRF
 * protection for cookie-authenticated mutations, complemented by Next.js
 * Server Actions' built-in origin checking), Secure in production, and
 * scoped to the whole app.
 */

import { cookies } from 'next/headers';

import { SESSION_TTL_MS } from '@/application/use-cases/issue-session';

export const SESSION_COOKIE_NAME = 'fit40_session';

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Sets the session cookie. Must be called from a Server Action or Route
 * Handler — Server Components cannot mutate cookies.
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
