/**
 * Shared session issuance for register and login.
 *
 * Generates a 256-bit opaque bearer token, persists only its SHA-256 hash,
 * and returns the raw token exactly once so the caller (a Server Action) can
 * hand it to the client as an HttpOnly cookie. The raw token is never stored
 * or logged.
 *
 * Token generation/hashing are runtime concerns injected through the
 * SessionTokenService port — this module has no Node crypto imports.
 */

import type { AuthSession, SessionRepository } from '@/application/ports/session-repository';
import type { SessionTokenService } from '@/application/ports/session-token-service';
import type { UserId } from '@/domain/types/ids';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed expiry

export interface IssuedSession {
  /** Raw bearer token — return to the client once, never persist. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Builds a new session record and its raw bearer token without persisting
 * anything. Persistence is left to the caller (login persists via the session
 * repository; registration persists it atomically with the user).
 */
export function buildSession(
  tokenService: SessionTokenService,
  userId: UserId,
  now: Date = new Date(),
): { readonly token: string; readonly session: AuthSession } {
  const token = tokenService.generate();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  return {
    token,
    session: {
      tokenHash: tokenService.hash(token),
      userId,
      expiresAt,
      createdAt: now,
    },
  };
}

/**
 * Issues an authenticated session for login: generates the token and persists
 * the session record. The raw token is returned exactly once.
 */
export async function issueSession(
  sessionRepository: SessionRepository,
  tokenService: SessionTokenService,
  userId: UserId,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const { token, session } = buildSession(tokenService, userId, now);
  await sessionRepository.create(session);

  return { token, expiresAt: session.expiresAt };
}
